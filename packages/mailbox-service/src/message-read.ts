import type {
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageRepository,
} from "@remit/data-ports";
import { isEncapsulatedMessage } from "@remit/data-ports/message-parts";
import {
	buildBodyPartKey,
	isStorageNotFoundError,
	MATERIALIZED_SENTINEL_PART_PATH,
	MATERIALIZED_SENTINEL_V2_PART_PATH,
	type StorageService,
} from "@remit/storage-service";
import { isMessageBodySyncBroken } from "./body-sync-terminal.js";

/**
 * The slice of `BodySyncService` the read path needs to lazily materialize
 * deferred per-part objects.
 */
export interface BodyPartMaterializer {
	ensureBodyPartsStored(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		bodyStorageKey: string,
	): Promise<unknown>;
}

export interface MaterializeLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Re-arms the body-sync cue for one message (the read-path slice of
 * `BodySyncQueueService`).
 */
export interface BodySyncCue {
	requestBodySync(input: {
		accountId: string;
		mailboxId: string;
		messageId: string;
		uid?: number;
	}): Promise<void>;
}

export interface MaterializeResult {
	/** `false` when the body object was missing — the caller must not serve the body. */
	ready: boolean;
}

/**
 * Materialize the deferred per-part storage objects for a message before any
 * part is read. Distinguishes the two failure modes the body contract cares
 * about:
 *
 * - Missing storage object (never synced or lost) — re-arm the SYNC_MESSAGE_BODY
 *   cue so the worker (re)stores the body, and report `ready: false`. Not a
 *   500: a retry succeeds once the worker catches up.
 * - Any other error — rethrow so the request 500s and the bug is observable.
 *   Never swallowed, never "best-effort".
 *
 * No-op (`ready: true`) when the body isn't stored yet (no `bodyStorageKey`) or
 * when the parts were written eagerly.
 */
export const materializeBodyParts = async (
	materializer: BodyPartMaterializer,
	args: {
		accountConfigId: string;
		accountId: string;
		mailboxId: string;
		messageId: string;
		uid?: number;
		bodyStorageKey: string | undefined;
		cue: BodySyncCue;
		logger: MaterializeLogger;
	},
): Promise<MaterializeResult> => {
	const { accountConfigId, accountId, mailboxId, messageId, uid } = args;
	if (!args.bodyStorageKey) return { ready: true };

	try {
		await materializer.ensureBodyPartsStored(
			accountConfigId,
			accountId,
			messageId,
			args.bodyStorageKey,
		);
		return { ready: true };
	} catch (error: unknown) {
		if (!isStorageNotFoundError(error)) throw error;

		args.logger.warn(
			{ messageId, accountId, mailboxId },
			"Body object missing on read; re-arming body-sync cue and signalling retry",
		);
		await args.cue.requestBodySync({ accountId, mailboxId, messageId, uid });
		return { ready: false };
	}
};

export type BodyReadMiss = "NotFound" | "Broken" | "Pending";

export interface BodyReadMissDeps {
	message: Pick<IMessageRepository, "get">;
	mailbox: Pick<IMailboxRepository, "get">;
	envelope: Pick<IEnvelopeRepository, "listBodyParts">;
	storage: Pick<StorageService, "bodyPartExists" | "deleteKeys">;
}

export interface BodyReadMissInput {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	partPath: string;
}

/**
 * What a content read that found no object at a part key should answer. It
 * never enqueues: the describe read path (`materializeBodyParts`) re-arms the
 * body sync, and the client re-describes on every 202.
 *
 * - `NotFound` — the message, its mailbox under `accountId`, or a leaf at
 *   `partPath` does not exist; no retry can produce the object.
 * - `Broken` — the body sync exhausted its retries against a message the
 *   server still holds (`isMessageBodySyncBroken`).
 * - `Pending` — anything else; a retry after the next describe succeeds.
 *
 * A missing leaf under a present `.materialized` sentinel means the sentinel
 * no longer vouches for its parts, and `ensureBodyPartsStored` would skip the
 * message forever. The sentinel is dropped so the next describe materializes
 * the parts again; that delete is the one write here.
 */
export const resolveBodyReadMiss = async (
	deps: BodyReadMissDeps,
	{ accountConfigId, accountId, messageId, partPath }: BodyReadMissInput,
): Promise<BodyReadMiss> => {
	const [message] = await deps.message.get([messageId]);
	if (!message) return "NotFound";
	const [mailbox] = await deps.mailbox.get(accountId, [message.mailboxId]);
	if (!mailbox) return "NotFound";
	if (
		await isMessageBodySyncBroken(
			deps.storage,
			accountConfigId,
			accountId,
			messageId,
		)
	) {
		return "Broken";
	}
	const bodyParts = await deps.envelope.listBodyParts(messageId);
	const leaf = bodyParts.find(
		(part) => part.partPath === partPath && !part.isMultipart,
	);
	if (!leaf) return "NotFound";
	if (!message.bodyStorageKey) return "Pending";
	const sentinel = bodyParts.some(isEncapsulatedMessage)
		? MATERIALIZED_SENTINEL_V2_PART_PATH
		: MATERIALIZED_SENTINEL_PART_PATH;
	if (
		await deps.storage.bodyPartExists(
			accountConfigId,
			accountId,
			messageId,
			sentinel,
		)
	) {
		await deps.storage.deleteKeys([
			buildBodyPartKey(accountConfigId, accountId, messageId, sentinel),
		]);
	}
	return "Pending";
};
