import { isStorageNotFoundError } from "@remit/storage-service";

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
