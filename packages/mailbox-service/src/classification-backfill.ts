import type {
	IAccountConfigRepository,
	IAddressRepository,
	IMessageRepository,
	IThreadMessageRepository,
	ThreadMessageItem,
} from "@remit/data-ports";
import { MessageClassificationState } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { parseMessageBody } from "./body-parse.js";
import { extractSnippet } from "./body-sync.js";
import { classifyParsedMessage } from "./classify-message.js";
import { extractListId } from "./filters/list-id.js";
import {
	denormalizeMessageCategory,
	hasDecidedCategory,
} from "./message-category.js";

const DEFAULT_BATCH_SIZE = 200;

/**
 * Where the full-corpus pass left off: the identity of the account it was
 * working through, and the page cursor within that account. Resuming looks the
 * account up by id and re-opens it at its saved cursor, rather than re-scanning
 * the whole corpus from the top after an interruption. A checkpoint naming no
 * configured account restarts the pass.
 */
export interface ClassificationBackfillCheckpoint {
	accountConfigId: string;
	continuationToken?: string;
}

/**
 * Persistence for {@link ClassificationBackfillCheckpoint}, injected so the
 * pass stays testable with an in-memory fake; the real entrypoint backs it
 * with a file. `clear()` runs once the whole corpus has been scanned, so a
 * later run starts fresh rather than reading a stale finished-run checkpoint.
 */
export interface ClassificationBackfillCheckpointStore {
	load(): Promise<ClassificationBackfillCheckpoint | undefined>;
	save(checkpoint: ClassificationBackfillCheckpoint): Promise<void>;
	clear(): Promise<void>;
}

export interface ClassificationBackfillDeps {
	accountConfigService: Pick<IAccountConfigRepository, "listAll">;
	/** Reads the sender's `Address.flags.category` override (issue #299). */
	addressService: Pick<IAddressRepository, "getAddress">;
	threadMessageService: Pick<
		IThreadMessageRepository,
		"listByAccount" | "findAllByMessageId" | "update"
	>;
	messageService: Pick<IMessageRepository, "get" | "update">;
	storageService: Pick<StorageService, "retrieve">;
}

export interface ClassificationBackfillLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error?(obj: Record<string, unknown>, msg: string): void;
}

export interface ClassificationBackfillTotals {
	scanned: number;
	alreadyExamined: number;
	alreadyCategorized: number;
	skippedNoBody: number;
	backfilled: number;
	failed: number;
}

export interface ClassificationBackfillResult
	extends ClassificationBackfillTotals {
	failedThreadMessageIds: string[];
}

export interface ClassificationBackfillProgress
	extends ClassificationBackfillTotals {
	accountConfigId: string;
}

export interface ClassificationBackfillOptions {
	/** Rows fetched per `listByAccount` page. */
	batchSize?: number;
	checkpointStore?: ClassificationBackfillCheckpointStore;
	logger?: ClassificationBackfillLogger;
	/** Called once per page, after that page's rows are settled. */
	onProgress?: (progress: ClassificationBackfillProgress) => void;
}

const emptyTotals = (): ClassificationBackfillTotals => ({
	scanned: 0,
	alreadyExamined: 0,
	alreadyCategorized: 0,
	skippedNoBody: 0,
	backfilled: 0,
	failed: 0,
});

/**
 * Read the stored raw source, classify it once, and record that the
 * classifier ran. Kept as its own function (rather than inline in a try/catch)
 * so the caller can contain a failure with `.then(fulfilled, rejected)`
 * instead of a block catch, which keeps the `try` around the one call whose
 * failure this contains.
 *
 * The ThreadMessage rows are denormalized BEFORE the Message update, for the
 * same reason the deleted in-sync backfill did it that way (issue #320): the
 * signal this pass selects by — `classificationState` — is written in the
 * Message update, so a failure between the two writes leaves both undone and
 * the rerun redoes them. Writing the Message first would strand the
 * denormalized rows at `uncategorized` forever — the row reads as examined and
 * the retry returns early.
 */
const classifyAndApply = async (
	deps: ClassificationBackfillDeps,
	accountConfigId: string,
	row: ThreadMessageItem,
	bodyStorageKey: string,
): Promise<void> => {
	const body = await deps.storageService.retrieve(bodyStorageKey);
	const parsed = await parseMessageBody(body);
	const classification = await classifyParsedMessage(
		deps.addressService,
		accountConfigId,
		parsed,
	);

	// The same denormalized fields the body-store path writes (see
	// `applyPostStoreSteps`), not just the category: the snippet and `List-Id`
	// are derived from the same bytes already in hand, and the rows this pass
	// reaches never got them — the pass that stored the body is the pass that
	// classifies, and it never ran for this cohort.
	await denormalizeMessageCategory(
		{ threadMessageService: deps.threadMessageService },
		accountConfigId,
		row.messageId,
		{
			category: classification.category,
			snippet: extractSnippet(parsed),
			listId: extractListId(parsed),
		},
	);

	await deps.messageService.update(row.messageId, {
		...classification,
		classificationState: MessageClassificationState.Examined,
	});
};

/**
 * One-time, resumable pass that classifies the stored-body cohort the
 * classifier has never examined (issue #1197): rows whose bodies were synced
 * before the classifier reached them, which carry the `NotExamined` sentinel
 * on `Message.classificationState` and so stay `uncategorized` in the list —
 * the field is what selects the cohort, and nothing on the sync path selects
 * it. Read-only against the stored raw source: it never opens IMAP, and it
 * has no placement or filter side effects — the same bounds the in-sync
 * backfill #1173 removed had. Index-time moves and filter actions are
 * decisions that already ran (or were declined) when the body first landed;
 * re-running them would move mail the user has since filed by hand.
 *
 * A row is a candidate when its Message carries `NotExamined` — the named
 * pending state, never inferred from `category` or from `bodyStorageKey` —
 * and has a `bodyStorageKey`; a candidate without a stored body has nothing
 * local to read, and the ordinary sync path will classify it once the body
 * lands. A candidate whose category is already decided is marked `Examined`
 * without re-deriving anything: those rows were classified by a pass that
 * predates the field, and RFC 034 Decision 3.1's write-once category must not
 * be recomputed (#355). The classification itself is
 * {@link classifyParsedMessage} — the same rule table, and the same sender
 * override, the body-store path classifies with.
 *
 * Chunked by `listByAccount`'s existing keyset pagination, one account at a
 * time in account-id order, so an interrupted run and its resume walk the
 * same sequence. A failure reading, parsing, or classifying one message is
 * contained to that message — logged, counted, and the pass continues: one
 * unreadable object must not strand the rest of the corpus.
 */
export const backfillClassifications = async (
	deps: ClassificationBackfillDeps,
	options: ClassificationBackfillOptions = {},
): Promise<ClassificationBackfillResult> => {
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const { logger, checkpointStore } = options;

	const accounts = [...(await deps.accountConfigService.listAll())].sort(
		(left, right) => left.accountConfigId.localeCompare(right.accountConfigId),
	);
	const startingCheckpoint = await checkpointStore?.load();
	const checkpointedIndex = startingCheckpoint
		? accounts.findIndex(
				(account) =>
					account.accountConfigId === startingCheckpoint.accountConfigId,
			)
		: -1;

	if (startingCheckpoint && checkpointedIndex === -1) {
		logger?.info(
			{ accountConfigId: startingCheckpoint.accountConfigId },
			"Classification backfill checkpoint names no configured account; restarting the pass",
		);
	}

	const startIndex = checkpointedIndex === -1 ? 0 : checkpointedIndex;
	const startContinuationToken =
		checkpointedIndex === -1
			? undefined
			: startingCheckpoint?.continuationToken;

	const totals = emptyTotals();
	const failedThreadMessageIds: string[] = [];
	// Messages settled this run. More than one ThreadMessage row can index one
	// Message, and the candidate fact lives on the Message, so without this a
	// second row would re-read the same body and re-classify it within the
	// same page — idempotent in outcome, wasteful in storage reads.
	const examinedMessageIds = new Set<string>();

	for (
		let accountIndex = startIndex;
		accountIndex < accounts.length;
		accountIndex++
	) {
		const account = accounts[accountIndex];
		let continuationToken: string | undefined =
			accountIndex === startIndex ? startContinuationToken : undefined;

		do {
			const page = await deps.threadMessageService.listByAccount(
				account.accountConfigId,
				{ limit: batchSize, continuationToken },
			);

			totals.scanned += page.items.length;

			if (page.items.length > 0) {
				const messages = await deps.messageService.get(
					page.items.map((row) => row.messageId),
				);
				const messageByMessageId = new Map(
					messages.map((message) => [message.messageId, message]),
				);

				for (const row of page.items) {
					const message = messageByMessageId.get(row.messageId);
					if (!message?.bodyStorageKey) {
						totals.skippedNoBody++;
						continue;
					}

					if (
						message.classificationState !==
							MessageClassificationState.NotExamined ||
						examinedMessageIds.has(row.messageId)
					) {
						totals.alreadyExamined++;
						continue;
					}

					// Classified by a pass that predates the field: record that it
					// ran, and touch nothing else — the write-once category is not
					// recomputed (#355), and the derived fields that pass wrote are
					// already on the row.
					if (hasDecidedCategory(message.category)) {
						const outcome = await deps.messageService
							.update(row.messageId, {
								classificationState: MessageClassificationState.Examined,
							})
							.then(
								() => null,
								(error: unknown) => error,
							);

						if (outcome !== null) {
							totals.failed++;
							failedThreadMessageIds.push(row.threadMessageId);
							logger?.error?.(
								{
									threadMessageId: row.threadMessageId,
									messageId: row.messageId,
									error:
										outcome instanceof Error
											? outcome.message
											: String(outcome),
								},
								"Classification backfill failed to record an already-categorized message; leaving it for a later pass",
							);
							continue;
						}

						examinedMessageIds.add(row.messageId);
						totals.alreadyCategorized++;
						continue;
					}

					const outcome = await classifyAndApply(
						deps,
						account.accountConfigId,
						row,
						message.bodyStorageKey,
					).then(
						() => null,
						(error: unknown) => error,
					);

					if (outcome !== null) {
						totals.failed++;
						failedThreadMessageIds.push(row.threadMessageId);
						logger?.error?.(
							{
								threadMessageId: row.threadMessageId,
								messageId: row.messageId,
								error:
									outcome instanceof Error ? outcome.message : String(outcome),
							},
							"Classification backfill failed for a message; leaving it for a later pass",
						);
						continue;
					}

					examinedMessageIds.add(row.messageId);
					totals.backfilled++;
				}
			}

			continuationToken = page.continuationToken;
			await checkpointStore?.save({
				accountConfigId: account.accountConfigId,
				continuationToken,
			});

			logger?.info(
				{ accountConfigId: account.accountConfigId, ...totals },
				"Classification backfill progress",
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
