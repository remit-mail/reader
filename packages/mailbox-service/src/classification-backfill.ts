import type {
	IAccountConfigRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import type { ParsedMail } from "mailparser";
import { parseMessageBody } from "./body-parse.js";
import type { AuthenticityVerdictValue } from "./heuristics/resolveAuthenticityVerdict.js";

const DEFAULT_BATCH_SIZE = 200;

/** The sentinel every message written before the derivation shipped carries. */
const NOT_EVALUATED = "NotEvaluated";

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

/**
 * The derivation, behind the two calls the pass makes per message. Injected
 * rather than inlined so the rule table stays pure (`resolveAuthenticityVerdict`)
 * while this pass stays testable with a fake that answers from constants.
 */
export interface ClassificationBackfillAuthenticityService {
	/**
	 * Resolve the verdict for one stored message: look up the applicable
	 * `(senderKey, signerDomain)` pair's standing and the sender's address
	 * flags, and delegate to the pure derivation.
	 */
	resolveVerdict(
		accountConfigId: string,
		parsed: ParsedMail,
	): Promise<AuthenticityVerdictValue>;

	/**
	 * Count the message against its pair — the one write this pass makes
	 * beyond the verdict itself, and the only writer of standing there is.
	 */
	observeStanding(accountConfigId: string, parsed: ParsedMail): Promise<void>;
}

export interface ClassificationBackfillDeps {
	accountConfigService: Pick<IAccountConfigRepository, "listAll">;
	threadMessageService: Pick<IThreadMessageRepository, "listByAccount">;
	messageService: Pick<IMessageRepository, "get" | "update">;
	storageService: Pick<StorageService, "retrieve">;
	authenticityService: ClassificationBackfillAuthenticityService;
}

export interface ClassificationBackfillLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error?(obj: Record<string, unknown>, msg: string): void;
}

export interface ClassificationBackfillTotals {
	scanned: number;
	alreadySet: number;
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
	alreadySet: 0,
	skippedNoBody: 0,
	backfilled: 0,
	failed: 0,
});

/**
 * Read the stored raw source, derive the verdict, write it, and count the
 * message against its pair. Kept as its own function (rather than inline in a
 * try/catch) so the caller can contain a failure with `.then(fulfilled,
 * rejected)` instead of a block catch, which keeps the `try` around the one
 * call whose failure this contains.
 *
 * The verdict is written before the pair is observed, and an observation
 * failure is therefore not undoable: the row is done, a rerun reads it as
 * `alreadySet`, and the lost observation is accepted — standing is a noise
 * filter, not a control, and one missed increment never strands the corpus.
 */
const deriveAndApplyVerdict = async (
	deps: ClassificationBackfillDeps,
	accountConfigId: string,
	messageId: string,
	bodyStorageKey: string,
): Promise<AuthenticityVerdictValue> => {
	const body = await deps.storageService.retrieve(bodyStorageKey);
	const parsed = await parseMessageBody(body);

	const verdict = await deps.authenticityService.resolveVerdict(
		accountConfigId,
		parsed,
	);
	await deps.messageService.update(messageId, { authenticityVerdict: verdict });

	await deps.authenticityService.observeStanding(accountConfigId, parsed);

	return verdict;
};

/**
 * One-time, resumable pass that derives `Message.authenticityVerdict` for the
 * stored-body cohort the derivation has never run on (issue #1197): rows
 * whose bodies were synced before the tier existed, which carry the
 * `NotEvaluated` sentinel. Read-only against the stored raw source: it never
 * opens IMAP and never touches anything but the single
 * `authenticityVerdict` field (plus the pair observation the derivation
 * counts).
 *
 * A row is a candidate when its Message carries `NotEvaluated` — the named
 * pending state, never inferred from absence — and has a `bodyStorageKey`; a
 * candidate without a stored body has nothing local to read, and the ordinary
 * sync path will derive the verdict for it once the body lands.
 *
 * Chunked by `listByAccount`'s existing keyset pagination, one account at a
 * time in account-id order, so an interrupted run and its resume walk the same
 * sequence. A failure reading, parsing, or deriving one message is contained
 * to that message — logged, counted, and the pass continues: one unreadable
 * object must not strand the rest of the corpus.
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

					if (message.authenticityVerdict !== NOT_EVALUATED) {
						totals.alreadySet++;
						continue;
					}

					const outcome = await deriveAndApplyVerdict(
						deps,
						account.accountConfigId,
						row.messageId,
						message.bodyStorageKey,
					).then(
						(verdict) => ({ error: null, verdict }) as const,
						(error: unknown) => ({ error, verdict: null }) as const,
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
							"Classification backfill failed for a message; leaving it for a later pass",
						);
						continue;
					}

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
