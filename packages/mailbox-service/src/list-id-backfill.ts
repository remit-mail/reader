import type {
	IAccountConfigRepository,
	IMessageRepository,
	IThreadMessageRepository,
	ThreadMessageItem,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { parseMessageBody } from "./body-parse.js";
import { extractListId } from "./filters/list-id.js";

const DEFAULT_BATCH_SIZE = 200;

/**
 * Where the full-corpus pass left off: the index into the account list (in
 * `listAll()` order) it was working through, and the page cursor within that
 * account. Resuming skips every account before it entirely and re-opens the
 * in-flight one at its saved cursor, rather than re-scanning the whole corpus
 * from the top after an interruption.
 */
export interface ListIdBackfillCheckpoint {
	accountIndex: number;
	continuationToken?: string;
}

/**
 * Persistence for {@link ListIdBackfillCheckpoint}, injected so the pass stays
 * testable with an in-memory fake; the real entrypoint backs it with a file.
 * `clear()` runs once the whole corpus has been scanned, so a later run starts
 * fresh rather than reading a stale finished-run checkpoint.
 */
export interface ListIdBackfillCheckpointStore {
	load(): Promise<ListIdBackfillCheckpoint | undefined>;
	save(checkpoint: ListIdBackfillCheckpoint): Promise<void>;
	clear(): Promise<void>;
}

export interface ListIdBackfillDeps {
	accountConfigService: Pick<IAccountConfigRepository, "listAll">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"listByAccount" | "update"
	>;
	messageService: Pick<IMessageRepository, "get">;
	storageService: Pick<StorageService, "retrieve">;
}

export interface ListIdBackfillLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error?(obj: Record<string, unknown>, msg: string): void;
}

export interface ListIdBackfillTotals {
	scanned: number;
	alreadySet: number;
	skippedNoBody: number;
	backfilled: number;
	noListId: number;
	failed: number;
}

export interface ListIdBackfillResult extends ListIdBackfillTotals {
	failedThreadMessageIds: string[];
}

export interface ListIdBackfillProgress extends ListIdBackfillTotals {
	accountConfigId: string;
}

export interface ListIdBackfillOptions {
	/** Rows fetched per `listByAccount` page. */
	batchSize?: number;
	checkpointStore?: ListIdBackfillCheckpointStore;
	logger?: ListIdBackfillLogger;
	/** Called once per page, after that page's rows are settled. */
	onProgress?: (progress: ListIdBackfillProgress) => void;
}

const emptyTotals = (): ListIdBackfillTotals => ({
	scanned: 0,
	alreadySet: 0,
	skippedNoBody: 0,
	backfilled: 0,
	noListId: 0,
	failed: 0,
});

/**
 * Read the stored raw source, derive `List-Id`, and — only when one is
 * present — write it. Kept as its own function (rather than inline in a
 * try/catch) so the caller can contain a failure with `.then(fulfilled,
 * rejected)` instead of a block catch, matching how `BodySyncService`
 * contains a per-message backfill failure.
 */
const deriveAndApplyListId = async (
	deps: ListIdBackfillDeps,
	accountConfigId: string,
	row: ThreadMessageItem,
	bodyStorageKey: string,
): Promise<string> => {
	const body = await deps.storageService.retrieve(bodyStorageKey);
	const parsed = await parseMessageBody(body);
	const listId = extractListId(parsed);

	if (listId) {
		await deps.threadMessageService.update(
			accountConfigId,
			row.threadMessageId,
			{ listId },
			{
				composites: {
					sentDate: row.sentDate,
					mailboxId: row.mailboxId,
					isRead: row.isRead,
					isDeleted: row.isDeleted,
					hasStars: row.hasStars,
					hasAttachment: row.hasAttachment,
				},
			},
		);
	}

	return listId;
};

/**
 * One-time, resumable pass that derives `ThreadMessage.listId` for rows synced
 * before header extraction shipped (issue #263). Read-only against the stored
 * raw source: it never opens IMAP and never touches anything but the single
 * `listId` field.
 *
 * A row is a candidate when `listId` is `undefined` — written before the
 * column existed, or written since by a path that found no `List-Id` header
 * (body-sync only sets the field when the header is present, so "no header"
 * and "not yet backfilled" look the same on the row; re-checking an
 * already-correct empty row is wasted work, never a wrong answer). A
 * candidate whose Message has no `bodyStorageKey` yet is left alone — its
 * body was never synced, so there is nothing local to read, and the ordinary
 * sync path will populate `listId` for it once the body lands.
 *
 * Chunked by `listByAccount`'s existing keyset pagination, one account at a
 * time in `listAll()` order. A failure reading or parsing one message's
 * stored body is contained to that message — logged, counted, and the pass
 * continues — the same containment `BodySyncService`'s classification
 * backfill uses for the same reason: one unreadable object must not strand
 * the rest of the corpus.
 */
export const backfillListIds = async (
	deps: ListIdBackfillDeps,
	options: ListIdBackfillOptions = {},
): Promise<ListIdBackfillResult> => {
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const { logger, checkpointStore } = options;

	const accounts = await deps.accountConfigService.listAll();
	const startingCheckpoint = await checkpointStore?.load();
	const startIndex = startingCheckpoint?.accountIndex ?? 0;

	const totals = emptyTotals();
	const failedThreadMessageIds: string[] = [];

	for (
		let accountIndex = startIndex;
		accountIndex < accounts.length;
		accountIndex++
	) {
		const account = accounts[accountIndex];
		let continuationToken: string | undefined =
			accountIndex === startIndex
				? startingCheckpoint?.continuationToken
				: undefined;

		do {
			const page = await deps.threadMessageService.listByAccount(
				account.accountConfigId,
				{ limit: batchSize, continuationToken },
			);

			totals.scanned += page.items.length;
			const candidates = page.items.filter((row) => row.listId === undefined);
			totals.alreadySet += page.items.length - candidates.length;

			if (candidates.length > 0) {
				const messages = await deps.messageService.get(
					candidates.map((row) => row.messageId),
				);
				const messageByMessageId = new Map(
					messages.map((message) => [message.messageId, message]),
				);

				for (const row of candidates) {
					const message = messageByMessageId.get(row.messageId);
					if (!message?.bodyStorageKey) {
						totals.skippedNoBody++;
						continue;
					}

					const outcome = await deriveAndApplyListId(
						deps,
						account.accountConfigId,
						row,
						message.bodyStorageKey,
					).then(
						(listId) => ({ error: null, listId }) as const,
						(error: unknown) => ({ error, listId: null }) as const,
					);

					if (outcome.error !== null) {
						totals.failed++;
						failedThreadMessageIds.push(row.threadMessageId);
						logger?.error?.(
							{
								threadMessageId: row.threadMessageId,
								messageId: row.messageId,
								error:
									outcome.error instanceof Error
										? outcome.error.message
										: String(outcome.error),
							},
							"ListId backfill failed for a message; leaving it for a later pass",
						);
						continue;
					}

					if (outcome.listId) {
						totals.backfilled++;
					} else {
						totals.noListId++;
					}
				}
			}

			continuationToken = page.continuationToken;
			await checkpointStore?.save({
				accountIndex,
				continuationToken,
			});

			logger?.info(
				{ accountConfigId: account.accountConfigId, ...totals },
				"ListId backfill progress",
			);
			options.onProgress?.({
				accountConfigId: account.accountConfigId,
				...totals,
			});
		} while (continuationToken);
	}

	await checkpointStore?.clear();

	return { ...totals, failedThreadMessageIds };
};
