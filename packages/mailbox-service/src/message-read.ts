import { isStorageNotFoundError } from "@remit/storage-service";

export interface MessageOwnershipClient {
	message: { get(messageId: string): Promise<{ mailboxId: string }> };
	mailbox: {
		get(
			accountId: string,
			mailboxIds: string[],
		): Promise<{ mailboxId: string; accountId: string }[]>;
	};
	account: {
		listAllByAccountConfig(
			accountConfigId: string,
		): Promise<{ accountId: string }[]>;
	};
}

export type MessageOwnership =
	| { outcome: "Owned"; accountId: string }
	| { outcome: "NotOwned" }
	| { outcome: "MixedAccounts" };

/**
 * Resolve the account that owns every message in `messageIds` for the caller.
 * Messages have no tenant column, so ownership resolves through the mailbox:
 * the caller's own accounts (from their accountConfigId) scope a mailbox
 * lookup, and a mailbox resolves only under the account that owns it — a
 * foreign message never resolves. The tenant comes from the caller's config,
 * never from the row being read. The whole batch must resolve to a single
 * account — the downstream flag/move/delete services take one accountId — so a
 * batch spanning accounts is its own outcome.
 */
export const resolveMessageOwnership = async (
	client: MessageOwnershipClient,
	messageIds: string[],
	callerAccountConfigId: string,
): Promise<MessageOwnership> => {
	const messages = await Promise.all(
		messageIds.map((id) => client.message.get(id)),
	);
	const mailboxIds = [...new Set(messages.map((m) => m.mailboxId))];

	const ownedAccounts = await client.account.listAllByAccountConfig(
		callerAccountConfigId,
	);

	const accountByMailbox = new Map<string, string>();
	for (const { accountId } of ownedAccounts) {
		const rows = await client.mailbox.get(accountId, mailboxIds);
		for (const row of rows) {
			accountByMailbox.set(row.mailboxId, row.accountId);
		}
	}

	if (mailboxIds.some((id) => !accountByMailbox.has(id))) {
		return { outcome: "NotOwned" };
	}

	const accountIds = [...new Set(accountByMailbox.values())];
	if (accountIds.length !== 1) return { outcome: "MixedAccounts" };

	return { outcome: "Owned", accountId: accountIds[0] };
};

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
		cue: BodySyncCue | undefined;
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
		await args.cue?.requestBodySync({ accountId, mailboxId, messageId, uid });
		return { ready: false };
	}
};
