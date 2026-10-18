import type { FilterItem, OrganizeJobRequestItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	FilterClauseField,
	FilterDisabledReason,
	FilterState,
} from "@remit/domain-enums";
import { logger } from "@remit/logger-lambda";
import {
	type FilterMessage,
	FilterPipeline,
	type LiteralClauseNarrowing,
	literalClausesMatch,
	literalClauseTerms,
	NO_ACTION,
	PlacementMoveService,
} from "@remit/mailbox-service";
import { buildFilterConfig } from "@remit/mailbox-service/filter-config";
import type { RemitClient } from "./data-client.js";

/**
 * Hard cap on both the previewed and the applied set. A back-apply is a
 * data-heavy corpus pass (remit-data-heavy: frugal), bounded by counting
 * MATCHES as it pages a store-side narrowed listing, and the final match set
 * never exceeds this. It bounds the answer, never the corpus the question is
 * asked of (#459).
 */
export const ORGANIZE_MATCH_LIMIT = 500;

/**
 * The predicate + action for one back-apply pass — the OrganizeInput fields,
 * flattened. The action fields carry absence as the `"None"` sentinel (RFC 034
 * Decision 3.1).
 */
export interface OrganizePredicate {
	matchOperator: FilterItem["matchOperator"];
	literalClauses: FilterItem["literalClauses"];
	actionLabelId: string;
	actionMailboxId: string;
}

/**
 * The predicate a back-apply job snapshotted onto its row, read back verbatim so
 * the worker runs exactly what the request asked for.
 */
export const predicateFromJob = (
	job: OrganizeJobRequestItem,
): OrganizePredicate => ({
	matchOperator: job.matchOperator,
	literalClauses: job.literalClauses,
	actionLabelId: job.actionLabelId,
	actionMailboxId: job.actionMailboxId,
});

/**
 * One corpus message projected onto the fields a literal clause matches
 * against, paired with its id. Sourced from the core thread rows.
 */
export interface OrganizeCandidate {
	messageId: string;
	message: FilterMessage;
}

/**
 * One page of the narrowed corpus, cursored exactly as the underlying listing
 * is: an absent `continuationToken` means the store has no more rows matching
 * the terms, never that a read window ran out.
 */
export interface OrganizeCandidatePage {
	items: OrganizeCandidate[];
	continuationToken?: string;
}

/** What to ask the store for, and where to resume. */
export interface OrganizeCandidateQuery extends LiteralClauseNarrowing {
	limit: number;
	continuationToken?: string;
	mailboxIds?: readonly string[];
}

/**
 * Where a pass looks and which standing filter it runs for. A filter
 * back-apply narrows the corpus to the inbox and matches a body-content clause
 * on the stored preview; an "all like these" pass sets neither.
 */
export interface OrganizeMatchScope {
	filterId?: string;
	mailboxIds?: readonly string[];
}

export interface OrganizeMatchDeps {
	/**
	 * One page of the account's messages as literal-match candidates, with the
	 * clause terms evaluated by the store. Paged rather than capped, so the
	 * caller's bound falls on matches instead of on how far back the read
	 * reached (#459).
	 */
	listAccountFilterMessages: (
		accountConfigId: string,
		query: OrganizeCandidateQuery,
	) => Promise<OrganizeCandidatePage>;
}

/**
 * Why the matcher refused a predicate. A refusal is an expected outcome of
 * asking for a rule this deployment cannot evaluate, not a fault: the HTTP
 * boundary words it as a 400 and the back-apply worker fails the job row on it,
 * neither of which may treat it as the infrastructure failure a throw would
 * make it (reader #463).
 */
export interface OrganizeRejection {
	reason:
		| "BodyContentUnsupported"
		| "FilterNotActive"
		| "FilterMissing"
		| "FolderMissing";
	message: string;
}

/** The matched ids. */
export interface OrganizeMatched {
	rejected: null;
	messageIds: string[];
}

/** The predicate was refused: nothing matched, and nothing may be applied. */
export interface OrganizeMatchRejected {
	rejected: OrganizeRejection;
}

export type OrganizeMatchResult = OrganizeMatched | OrganizeMatchRejected;

/**
 * A `HasWords` clause matches the message body (RFC 031, `clauseMatches`). The
 * live index-time filter evaluates it against the full parsed body
 * (`body-sync.ts` `toFilterMessage`); the corpus slice carries only
 * `From`/`Subject` at full fidelity and no faithful body, so it cannot serve a
 * body-content clause without silently narrowing the match to whatever preview
 * happened to be stored. A body-content clause on an "all like these" pass is
 * refused instead of returning a wrong set.
 */
export const BODY_CONTENT_REJECTION_MESSAGE =
	"Organize cannot match a body-content (HasWords) clause over the mailbox: it reads only each message's preview, not its body";

const bodyContentRejection = (
	clauses: OrganizePredicate["literalClauses"],
): OrganizeRejection | null =>
	clauses.some((clause) => clause.field === FilterClauseField.HasWords)
		? {
				reason: "BodyContentUnsupported",
				message: BODY_CONTENT_REJECTION_MESSAGE,
			}
		: null;

/**
 * The refusal a predicate carries on its own, decidable without reading the
 * corpus: a body-content clause is refused up front. `createOrganizeJob` runs
 * this before enqueueing and {@link matchOrganize} runs it too, so preview, the
 * worker and the request boundary all refuse the same rule (reader #463).
 */
export const organizePredicateRejection = (
	predicate: OrganizePredicate,
): OrganizeRejection | null => bodyContentRejection(predicate.literalClauses);

/**
 * The store selects on the clause terms, this refines what it returned and
 * stops at `limit` MATCHES. Serves `From`/`Subject` clauses at
 * full fidelity from the core thread rows; body-content (`HasWords`) clauses are
 * refused before this runs (see {@link bodyContentRejection}).
 *
 * The terms are a narrowing, not the verdict ({@link literalClauseTerms}), so
 * every page is still run through {@link literalClausesMatch} — and paging
 * continues until the cap fills or the store runs out, which is what makes the
 * bound a bound on results rather than on the newest `limit` rows (#459).
 * Deduped by message id: the same mail filed in two folders is one match.
 */
const matchLiteral = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number,
	scope: OrganizeMatchScope,
): Promise<string[]> => {
	const clauses = predicate.literalClauses;
	const narrowing = literalClauseTerms(clauses, predicate.matchOperator);
	if (!narrowing) return [];

	const matched: string[] = [];
	const seen = new Set<string>();
	let continuationToken: string | undefined;
	do {
		const page = await deps.listAccountFilterMessages(accountConfigId, {
			...narrowing,
			limit,
			continuationToken,
			mailboxIds: scope.mailboxIds,
		});
		for (const { messageId, message } of page.items) {
			if (seen.has(messageId)) continue;
			seen.add(messageId);
			if (!literalClausesMatch(clauses, predicate.matchOperator, message)) {
				continue;
			}
			matched.push(messageId);
			if (matched.length >= limit) return matched;
		}
		continuationToken = page.continuationToken;
	} while (continuationToken);
	return matched;
};

/**
 * The matcher shared by preview and apply — the previewed set equals the applied
 * set for the same input. Read-only. Returns the matching message ids, bounded.
 *
 * - A predicate with no clause matches nothing, mirroring the index-time filter
 *   matcher.
 * - A predicate the corpus read cannot evaluate (a body-content clause on an
 *   "all like these" pass, see {@link bodyContentRejection}) comes back as a
 *   rejection, so a caller can tell a refused rule from a broken deployment
 *   (reader #463).
 */
export const matchOrganize = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number = ORGANIZE_MATCH_LIMIT,
	scope: OrganizeMatchScope = {},
): Promise<OrganizeMatchResult> => {
	if (predicate.literalClauses.length === 0) {
		return { rejected: null, messageIds: [] };
	}
	const rejection = scope.filterId
		? null
		: organizePredicateRejection(predicate);
	if (rejection) return { rejected: rejection };
	const messageIds = await matchLiteral(
		deps,
		accountConfigId,
		predicate,
		limit,
		scope,
	);
	return { rejected: null, messageIds };
};

/**
 * The corpus read for a back-apply: one page of the account's messages,
 * newest-first across every mailbox, with the clause terms evaluated in the
 * query.
 *
 * `From`/`Subject`/`listId` come from the row verbatim (full fidelity), so a
 * `From`, `Subject`, `FromDomain` or `ListId` clause matches here exactly as it
 * does at index time. `text` is the row's stored body preview (`snippet`),
 * the same text search matches free words against. An "all like these" pass
 * refuses a body-content (`HasWords`) clause before reading it (see
 * {@link bodyContentRejection}); a filter back-apply matches it on the
 * preview, the mail search showed the user when the rule was made (#1354).
 */
const listAccountFilterMessagesFromClient =
	(client: RemitClient): OrganizeMatchDeps["listAccountFilterMessages"] =>
	async (accountConfigId, query) => {
		const page = await client.threadMessage.listByFieldTerms(
			accountConfigId,
			query.terms,
			{
				operator: query.operator,
				limit: query.limit,
				continuationToken: query.continuationToken,
				excludeDeleted: true,
				mailboxIds: query.mailboxIds,
			},
		);
		return {
			items: page.items.map((row) => ({
				messageId: row.messageId,
				message: {
					from: row.fromEmail ?? "",
					fromName: row.fromName ?? "",
					subject: row.subject ?? "",
					text: row.snippet ?? "",
					listId: row.listId ?? "",
				},
			})),
			continuationToken: page.continuationToken,
		};
	};

/** The matcher deps for the running backend/worker. */
export const buildOrganizeMatchDeps = (
	client: RemitClient,
): OrganizeMatchDeps => ({
	listAccountFilterMessages: listAccountFilterMessagesFromClient(client),
});

/**
 * The exclusive-move arm of a back-apply, wired exactly like the body-sync
 * placement mover (`sync-message-body.ts`): the local-first
 * {@link PlacementMoveService} over the shared message-management queue. A move
 * commits locally (marker + ThreadMessage + Message row) and enqueues a
 * `PLACEMENT_MOVE_PUSH` for the reconciler; its marker state engine makes a
 * redelivered job idempotent (mirrors #1297). Returns `undefined` when no
 * message-management queue is wired — the same gate body sync uses to keep the
 * move path off — so a move requested in that environment is counted as failed
 * rather than silently dropped (see {@link applyOrganize}).
 */
export const buildOrganizeMoveService = (
	client: RemitClient,
): PlacementMoveService | undefined => {
	const queueUrl = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
	if (!queueUrl) return undefined;
	return new PlacementMoveService({
		messageService: client.message,
		threadMessageService: client.threadMessage,
		markerService: client.placementMove,
		addressService: client.address,
		mailboxSpecialUseService: client.mailboxSpecialUse,
		mailboxService: client.mailbox,
		sqsQueueUrl: queueUrl,
	});
};

export interface ApplyOrganizeDeps {
	client: RemitClient;
	moveService?: PlacementMoveService;
}

export interface ApplyOrganizeResult {
	applied: number;
	failed: number;
	/** Why each failed message failed, as the job reports it. */
	failures: string[];
}

/**
 * Apply the back-apply action to every matched message, reusing the index-time
 * apply plumbing: an idempotent MessageLabel upsert (additive) with
 * `appliedByFilterId` deliberately ABSENT — this path attributes to no filter,
 * exactly like a hand-applied label (RFC 034 Decision 3.3) — and an idempotent
 * folder move (exclusive). One poisoned message never fails the batch; it is
 * counted as failed and the pass continues.
 *
 * Every requested move happens. A standing filter acts at exactly two moments —
 * when a message is first seen, and when the user presses "run rules now" — and
 * holds no claim on that message afterwards, so it never arbitrates against a
 * later user-initiated apply (reader #497). Cross-filter precedence stays where
 * two filters collide over the same message at the same trigger
 * (`FilterPipeline`/`selectMoveWinner`), and `applied` therefore counts moves
 * that actually happened.
 */
export const applyOrganize = async (
	deps: ApplyOrganizeDeps,
	accountConfigId: string,
	messageIds: readonly string[],
	predicate: OrganizePredicate,
): Promise<ApplyOrganizeResult> => {
	const { client, moveService } = deps;
	const applyLabel =
		predicate.actionLabelId !== NO_ACTION && predicate.actionLabelId !== "";
	const applyMove =
		predicate.actionMailboxId !== NO_ACTION && predicate.actionMailboxId !== "";

	// A folder of another account is not this action's to fill: that mail is
	// skipped, label and all, as if it had not matched.
	type MessageOutcome = { kind: "applied" } | { kind: "skipped" };

	const applyToMessage = async (messageId: string): Promise<MessageOutcome> => {
		if (applyMove) {
			if (!moveService) {
				// An exclusive move was requested but this caller wired no move
				// service. Never silently pretend it applied — surface it as a
				// failed message so the job's failedCount reflects reality.
				throw new Error(
					"Organize move action requested but no move service is wired",
				);
			}
			const message = await client.message.get(messageId);
			const accountId = await client.mailbox.resolveAccountId(
				message.mailboxId,
			);
			if (!accountId) {
				throw new Error(
					`Cannot resolve owning account for mailbox ${message.mailboxId}`,
				);
			}
			const outcome = await moveService.moveMessage(
				accountConfigId,
				messageId,
				predicate.actionMailboxId,
				accountId,
			);
			if (outcome === "refused") return { kind: "skipped" };
		}
		if (applyLabel) {
			await client.messageLabel.apply({
				messageId,
				labelId: predicate.actionLabelId,
				accountConfigId,
			});
		}
		return { kind: "applied" };
	};

	const result: ApplyOrganizeResult = {
		applied: 0,
		failed: 0,
		failures: [],
	};
	for (const messageId of messageIds) {
		// Per-message isolation: one poisoned message is counted, its reason kept
		// for the job, and the pass continues.
		const outcome = await applyToMessage(messageId).catch((error: unknown) => ({
			kind: "failed" as const,
			reason: error instanceof Error ? error.message : String(error),
		}));
		if (outcome.kind === "skipped") continue;
		if (outcome.kind === "applied") {
			result.applied += 1;
			continue;
		}
		result.failed += 1;
		result.failures.push(outcome.reason);
		logger.warn(
			{ accountConfigId, messageId, reason: outcome.reason },
			"Organize could not apply its action to a message",
		);
	}
	return result;
};

const FILTER_NOT_ACTIVE_MESSAGE =
	"This filter is turned off or has expired. Turn it on to run it over the inbox.";

const FOLDER_MISSING_MESSAGE =
	"The folder this filter moves mail into no longer exists, so the filter was turned off. Pick another folder in the rule, then turn it on.";

const FILTER_MISSING_MESSAGE =
	"This filter was deleted before it could run over the inbox.";

const rejectFilter = (
	reason: OrganizeRejection["reason"],
	message: string,
): OrganizeMatchRejected => ({ rejected: { reason, message } });

/** A standing filter's predicate and action, read the way index time reads them. */
const predicateFromFilter = (filter: FilterItem): OrganizePredicate => ({
	matchOperator: filter.matchOperator,
	literalClauses: filter.literalClauses,
	actionLabelId: filter.actionLabelId,
	actionMailboxId: filter.actionMailboxId,
});

interface LoadedFilter {
	rejected: null;
	filter: FilterItem;
	predicate: OrganizePredicate;
}

/**
 * Read the filter a job names: refused when it was deleted or is not Active,
 * since index time evaluates neither.
 */
const loadFilter = async (
	client: Pick<RemitClient, "filter">,
	accountConfigId: string,
	filterId: string,
): Promise<LoadedFilter | OrganizeMatchRejected> => {
	const stored = await client.filter
		.get(accountConfigId, filterId)
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return null;
			throw error;
		});
	if (!stored) return rejectFilter("FilterMissing", FILTER_MISSING_MESSAGE);
	const filter = await client.filter.refreshExpiry(stored);
	if (filter.state !== FilterState.Active) {
		return rejectFilter("FilterNotActive", FILTER_NOT_ACTIVE_MESSAGE);
	}
	return { rejected: null, filter, predicate: predicateFromFilter(filter) };
};

/** Every inbox under the config — the folders a filter back-apply runs over. */
const inboxMailboxIds = async (
	client: Pick<RemitClient, "account" | "mailboxSpecialUse">,
	accountConfigId: string,
): Promise<string[]> => {
	const accounts =
		await client.account.listMailSourcesByAccountConfig(accountConfigId);
	const inboxes = await Promise.all(
		accounts.map((account) =>
			client.mailboxSpecialUse.findInboxMailbox(account.accountId),
		),
	);
	return inboxes.flatMap((inbox) => (inbox ? [inbox.mailboxId] : []));
};

/**
 * The message as the index-time pipeline reads it, from its thread row. The
 * body is the stored preview, so a `HasWords` clause matches what search
 * matched. A message deleted since the match has no row.
 */
const filterMessageOf = async (
	client: Pick<RemitClient, "threadMessage">,
	accountConfigId: string,
	messageId: string,
): Promise<FilterMessage | null> => {
	const row = await client.threadMessage
		.getByMessageId(accountConfigId, messageId)
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return null;
			throw error;
		});
	if (!row) return null;
	return {
		from: row.fromEmail ?? "",
		fromName: row.fromName ?? "",
		subject: row.subject ?? "",
		text: row.snippet ?? "",
		listId: row.listId ?? "",
	};
};

export interface FilterBackApplyResult {
	rejected: null;
	matched: number;
	applied: number;
	failed: number;
	failures: string[];
}

export interface FilterBackApplyDeps {
	client: RemitClient;
	matchDeps: OrganizeMatchDeps;
	moveService?: PlacementMoveService;
}

/**
 * Run one standing filter over the inbox as if each matching message had just
 * arrived. Every message the matcher returns is a match: its label always
 * applies, being additive. The index-time {@link FilterPipeline} only orders
 * the exclusive move, so the move is skipped where it names another active
 * filter. The pipeline sees the stored preview rather than the full body, so
 * its verdict on whether this filter matches is not asked; and an evaluate it
 * could not finish names no other filter, so the move goes ahead rather than
 * silently dropping out.
 */
export const backApplyFilter = async (
	deps: FilterBackApplyDeps,
	accountConfigId: string,
	filterId: string,
): Promise<FilterBackApplyResult | OrganizeMatchRejected> => {
	const { client, matchDeps, moveService } = deps;
	const loaded = await loadFilter(client, accountConfigId, filterId);
	if (loaded.rejected) return loaded;
	const config = buildFilterConfig({
		filterService: client.filter,
		messageLabelService: client.messageLabel,
		mailboxService: client.mailbox,
		placementMoveService: moveService,
	});
	if (!config) {
		throw new Error(
			"Filter back-apply needs the message-management queue to move mail",
		);
	}
	const pipeline = new FilterPipeline(config, logger);

	const mailboxIds = await inboxMailboxIds(client, accountConfigId);
	const nothing: FilterBackApplyResult = {
		rejected: null,
		matched: 0,
		applied: 0,
		failed: 0,
		failures: [],
	};
	if (mailboxIds.length === 0) return nothing;

	const match = await matchOrganize(
		matchDeps,
		accountConfigId,
		loaded.predicate,
		ORGANIZE_MATCH_LIMIT,
		{ filterId, mailboxIds },
	);
	if (match.rejected) return match;

	const { filter, predicate } = loaded;
	const folderAccountId =
		filter.actionMailboxId === NO_ACTION
			? undefined
			: await client.mailbox.resolveAccountId(filter.actionMailboxId);
	if (folderAccountId === null) {
		await client.filter.update(accountConfigId, filterId, {
			state: FilterState.Disabled,
			disabledReason: FilterDisabledReason.FolderMissing,
		});
		return rejectFilter("FolderMissing", FOLDER_MISSING_MESSAGE);
	}
	const result: FilterBackApplyResult = {
		...nothing,
		matched: match.messageIds.length,
	};
	for (const messageId of match.messageIds) {
		const message = await filterMessageOf(client, accountConfigId, messageId);
		if (!message) continue;
		const accountId = await client.mailbox.resolveAccountId(
			(await client.message.get(messageId)).mailboxId,
		);
		if (!accountId) continue;
		if (folderAccountId !== undefined && folderAccountId !== accountId) {
			continue;
		}
		const decision = await pipeline.evaluate(
			accountConfigId,
			accountId,
			messageId,
			message,
		);
		const move = (decision.move?.filterId ?? filterId) === filterId;
		if (!move && filter.actionLabelId === NO_ACTION) continue;
		const outcome = await applyOrganize(
			{ client, moveService },
			accountConfigId,
			[messageId],
			{
				...predicate,
				actionMailboxId: move ? filter.actionMailboxId : NO_ACTION,
			},
		);
		result.applied += outcome.applied;
		result.failed += outcome.failed;
		result.failures.push(...outcome.failures);
	}
	return result;
};

/** Whether a job row runs a standing filter rather than its own snapshot. */
export const isFilterJob = (
	job: Pick<OrganizeJobRequestItem, "filterId">,
): boolean => job.filterId !== NO_ACTION;
