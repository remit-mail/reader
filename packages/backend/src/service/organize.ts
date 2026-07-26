import type { FilterItem, OrganizeJobRequestItem } from "@remit/data-ports";
import { FilterClauseField } from "@remit/domain-enums";
import {
	DEFAULT_SEMANTIC_MATCH_THRESHOLD,
	type FilterMessage,
	literalClausesMatch,
	NO_ACTION,
	PlacementMoveService,
} from "@remit/mailbox-service";
import {
	type AnchorPayload,
	buildMessageAnchor,
	type VectorRecord,
	type VectorStoreService,
} from "@remit/search-service";
import {
	buildEmbeddingServiceFromEnv,
	buildVectorStoreFromEnv,
} from "@remit/search-service/from-env";
import type { RemitClient } from "./dynamodb.js";
import { noteSemanticCapabilityAbsence } from "./semantic-capability.js";

/**
 * Hard cap on both the previewed and the applied set. A back-apply is a
 * data-heavy corpus pass (remit-data-heavy: frugal): the semantic side is
 * bounded by the vector query's `topK`, the literal-only side by a paginated
 * message scan, and the final match set never exceeds this.
 */
export const ORGANIZE_MATCH_LIMIT = 500;

/**
 * How many chunk matches to pull per requested message. A message contributes
 * several chunk vectors (sender / subject / body / …); over-fetching chunks
 * keeps enough distinct messages after de-duplication to fill the cap.
 */
const VECTOR_CHUNK_FACTOR = 8;

/**
 * The predicate + action for one back-apply pass — the OrganizeInput fields,
 * flattened. `anchorMessageId` uses the `"None"` sentinel (never optional) to
 * mean "purely literal", matching how the job row and the action fields carry
 * absence (RFC 034 Decision 3.1).
 */
export interface OrganizePredicate {
	anchorMessageId: string;
	matchOperator: FilterItem["matchOperator"];
	literalClauses: FilterItem["literalClauses"];
	similarityThreshold: number;
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
	anchorMessageId: job.anchorMessageId,
	matchOperator: job.matchOperator,
	literalClauses: job.literalClauses,
	similarityThreshold: job.similarityThreshold,
	actionLabelId: job.actionLabelId,
	actionMailboxId: job.actionMailboxId,
});

/**
 * The vector-backed semantic side of the matcher — the only part that reaches
 * `sqlite-vec`/`@huggingface/transformers`. Constructed lazily (see
 * {@link OrganizeMatchDeps.semantic}) so a literal-only predicate never touches
 * the vector extension, and so a deployment that ships no vector pipeline only
 * fails on the import when a predicate actually asks to widen — where the
 * failure is caught and degraded rather than surfaced as a 500 (#226/#201).
 */
export interface OrganizeSemanticDeps {
	buildAnchor: (
		accountConfigId: string,
		anchorMessageId: string,
	) => Promise<AnchorPayload | null>;
	vectorStore: Pick<VectorStoreService, "query" | "getByMessage">;
}

/**
 * One corpus message projected onto the fields a literal clause matches
 * against, paired with its id. Sourced from the core message rows, never the
 * vector store, so literal matching runs on any deployment.
 */
export interface OrganizeCandidate {
	messageId: string;
	message: FilterMessage;
}

export interface OrganizeMatchDeps {
	/**
	 * Build the semantic side on demand. Invoked only for an anchored predicate,
	 * so constructing the embedder and vector store — and, on first use, the
	 * lazy import of the vector extension — is deferred until a widen is actually
	 * requested.
	 */
	semantic: () => OrganizeSemanticDeps;
	/**
	 * The account's messages as literal-match candidates, bounded and vector-free
	 * — the corpus slice a purely-literal (or degraded) pass scans.
	 */
	listAccountFilterMessages: (
		accountConfigId: string,
		limit: number,
	) => Promise<OrganizeCandidate[]>;
}

/** The matched ids plus whether the semantic widen was skipped as unavailable. */
export interface OrganizeMatchResult {
	messageIds: string[];
	semanticUnavailable: boolean;
}

const hasAnchor = (predicate: OrganizePredicate): boolean =>
	predicate.anchorMessageId !== NO_ACTION && predicate.anchorMessageId !== "";

/**
 * Reconstruct the literal-match view of a message from its already-indexed chunk
 * vectors — no body fetch, no re-embedding (remit-data-heavy: frugal). The
 * sender chunk carries the from address, the subject/body chunks the text; each
 * is the same 512-char preview the semantic side is derived from.
 */
const filterMessageFromChunks = (
	records: VectorRecord[],
): FilterMessage | null => {
	if (records.length === 0) return null;
	let subject = "";
	let fromName = "";
	let from = "";
	let listId = "";
	const textParts: string[] = [];
	for (const record of records) {
		const meta = record.metadata;
		if (meta.subject && !subject) subject = meta.subject;
		if (meta.fromName && !fromName) fromName = meta.fromName;
		if (meta.listId && !listId) listId = meta.listId;
		if (meta.chunkType === "sender" && meta.textPreview && !from) {
			from = meta.textPreview;
		}
		if (
			(meta.chunkType === "body" || meta.chunkType === "subject") &&
			meta.textPreview
		) {
			textParts.push(meta.textPreview);
		}
	}
	return { from, fromName, subject, listId, text: textParts.join("\n") };
};

/**
 * The semantic (anchor) arm: pool the anchor vector from the anchor message's
 * existing chunk vectors, fan out with a k-NN query gated on the cosine
 * threshold, then refine by literal clauses reconstructed from the same chunk
 * vectors. Every read here goes through the vector store; a deployment without
 * the vector pipeline fails on the first call, which {@link matchOrganize}
 * catches. Returns null when the anchor message has no vectors to pool.
 */
const matchSemantic = async (
	semantic: OrganizeSemanticDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number,
): Promise<string[] | null> => {
	const anchor = await semantic.buildAnchor(
		accountConfigId,
		predicate.anchorMessageId,
	);
	if (!anchor) return null;
	const threshold =
		predicate.similarityThreshold ?? DEFAULT_SEMANTIC_MATCH_THRESHOLD;
	const matches = await semantic.vectorStore.query({
		vector: anchor.anchorEmbedding,
		topK: limit * VECTOR_CHUNK_FACTOR,
		filter: { accountConfigId },
	});
	const bestScore = new Map<string, number>();
	for (const match of matches) {
		const messageId = match.metadata.messageId;
		const prev = bestScore.get(messageId);
		if (prev === undefined || match.score > prev) {
			bestScore.set(messageId, match.score);
		}
	}
	const base = [...bestScore.entries()]
		.filter(([, score]) => score >= threshold)
		.map(([messageId]) => messageId);

	const clauses = predicate.literalClauses;
	if (clauses.length === 0) return base.slice(0, limit);

	const matched: string[] = [];
	for (const messageId of base) {
		if (matched.length >= limit) break;
		const records = await semantic.vectorStore.getByMessage(messageId);
		const message = filterMessageFromChunks(records);
		if (!message) continue;
		if (literalClausesMatch(clauses, predicate.matchOperator, message)) {
			matched.push(messageId);
		}
	}
	return matched;
};

/**
 * A `HasWords` clause matches the message body (RFC 031, `clauseMatches`). The
 * live index-time filter evaluates it against the full parsed body
 * (`body-sync.ts` `toFilterMessage`); the vector-free corpus slice carries only
 * `From`/`Subject` at full fidelity and no faithful body, so it cannot serve a
 * body-content clause without silently narrowing the match to whatever preview
 * happened to be indexed. Body-content matching therefore requires the widen
 * (vector) path — {@link matchSemantic} reconstructs body text from chunk
 * previews there. This guard keeps the two matchers from diverging silently: a
 * body-content clause reaching the vector-free path fails loud instead of
 * returning a wrong set. It is unreachable today — no product surface emits a
 * `HasWords` clause (the organize UI sends empty `literalClauses`, the filter
 * builder emits none) — and stays a fail-fast for any future surface that does.
 */
const assertNoBodyContentClause = (
	clauses: OrganizePredicate["literalClauses"],
): void => {
	if (clauses.some((clause) => clause.field === FilterClauseField.HasWords)) {
		throw new Error(
			"Organize literal matching cannot evaluate a body-content (HasWords) clause without the vector pipeline — it requires the semantic widen path",
		);
	}
};

/**
 * The literal-only arm: scan a bounded, vector-free slice of the corpus and keep
 * the messages whose literal clauses match. Used both for a purely-literal
 * predicate and as the degraded fallback when a widen is requested on a
 * deployment without the vector pipeline. Serves `From`/`Subject` clauses at
 * full fidelity from the core thread rows; body-content (`HasWords`) clauses are
 * rejected up front (see {@link assertNoBodyContentClause}).
 */
const matchLiteral = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number,
): Promise<string[]> => {
	const clauses = predicate.literalClauses;
	assertNoBodyContentClause(clauses);
	const candidates = await deps.listAccountFilterMessages(
		accountConfigId,
		limit,
	);
	if (clauses.length === 0) {
		return candidates.slice(0, limit).map((c) => c.messageId);
	}
	const matched: string[] = [];
	for (const { messageId, message } of candidates) {
		if (matched.length >= limit) break;
		if (literalClausesMatch(clauses, predicate.matchOperator, message)) {
			matched.push(messageId);
		}
	}
	return matched;
};

/**
 * The matcher shared by preview and apply — the previewed set equals the applied
 * set for the same input. Read-only. Returns the matching message ids, bounded,
 * and whether the semantic widen was skipped as unavailable.
 *
 * - Semantic anchor: {@link matchSemantic}, built lazily so a literal-only
 *   predicate never touches the vector extension.
 * - Literal clauses (RFC 031) refine the candidate set; a purely-literal
 *   back-apply scans a bounded vector-free slice of the corpus instead.
 * - A predicate with neither an anchor nor a clause matches nothing, mirroring
 *   the index-time filter matcher.
 * - When a widen is requested but this deployment ships no vector pipeline, the
 *   capability-absence is absorbed exactly as `/search/semantic` absorbs it:
 *   the literal matches are returned (empty for an anchor-only predicate) with
 *   `semanticUnavailable` set, never a 500. Any other failure propagates.
 */
export const matchOrganize = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number = ORGANIZE_MATCH_LIMIT,
): Promise<OrganizeMatchResult> => {
	const anchored = hasAnchor(predicate);
	const clauses = predicate.literalClauses;
	if (!anchored && clauses.length === 0) {
		return { messageIds: [], semanticUnavailable: false };
	}

	if (!anchored) {
		const messageIds = await matchLiteral(
			deps,
			accountConfigId,
			predicate,
			limit,
		);
		return { messageIds, semanticUnavailable: false };
	}

	try {
		const semanticIds = await matchSemantic(
			deps.semantic(),
			accountConfigId,
			predicate,
			limit,
		);
		return { messageIds: semanticIds ?? [], semanticUnavailable: false };
	} catch (error) {
		if (!noteSemanticCapabilityAbsence(error)) throw error;
		// The widen cannot run on this deployment. Fall back to the literal
		// clauses over the corpus — nothing when the predicate is anchor-only —
		// and flag the absence so the client can say so.
		if (clauses.length === 0) {
			return { messageIds: [], semanticUnavailable: true };
		}
		const messageIds = await matchLiteral(
			deps,
			accountConfigId,
			predicate,
			limit,
		);
		return { messageIds, semanticUnavailable: true };
	}
};

let cachedSemantic: OrganizeSemanticDeps | null = null;

/**
 * Construct the semantic side from env on first use and memoize it. The embedder
 * and vector store are selected by env, independent of `DATA_BACKEND`; building
 * them is cheap (the vector extension imports lazily on the first store call),
 * but deferring construction keeps a literal-only preview clear of the whole
 * semantic graph.
 */
const buildSemanticFromEnv = (): OrganizeSemanticDeps => {
	if (cachedSemantic) return cachedSemantic;
	const embedder = buildEmbeddingServiceFromEnv();
	const store = buildVectorStoreFromEnv(embedder.dimensions);
	cachedSemantic = {
		buildAnchor: (accountConfigId, anchorMessageId) =>
			buildMessageAnchor({ store }, { accountConfigId, anchorMessageId }),
		vectorStore: store,
	};
	return cachedSemantic;
};

/**
 * A bounded, vector-free corpus slice for a literal back-apply: the account's
 * messages projected onto the literal-match fields, gathered newest-first across
 * every mailbox and capped. Reads the core thread rows, so it runs on a
 * deployment that ships no vector pipeline. Deduped by message id — the same
 * mail filed in two folders is one candidate.
 *
 * `From`/`Subject`/`listId` come from the row verbatim (full fidelity), so a
 * `From`, `Subject`, `FromDomain` or `ListId` clause matches here exactly as it
 * does at index time. `text` (the body) is left empty: the thread row carries
 * only a truncated `snippet`, and matching
 * a body-content clause against a preview would silently diverge from the live
 * index-time filter's full-body match. Body-content (`HasWords`) clauses are
 * rejected before this is read (see {@link assertNoBodyContentClause}), so the
 * empty `text` is never matched against.
 */
const listAccountFilterMessagesFromClient =
	(client: RemitClient): OrganizeMatchDeps["listAccountFilterMessages"] =>
	async (accountConfigId, limit) => {
		const candidates: OrganizeCandidate[] = [];
		const seen = new Set<string>();
		let continuationToken: string | undefined;
		do {
			const page = await client.threadMessage.listByDate(accountConfigId, {
				limit,
				continuationToken,
				excludeDeleted: true,
			});
			for (const row of page.items) {
				if (seen.has(row.messageId)) continue;
				seen.add(row.messageId);
				candidates.push({
					messageId: row.messageId,
					message: {
						from: row.fromEmail ?? "",
						fromName: row.fromName ?? "",
						subject: row.subject ?? "",
						text: "",
						listId: row.listId ?? "",
					},
				});
				if (candidates.length >= limit) return candidates;
			}
			continuationToken = page.continuationToken;
		} while (continuationToken);
		return candidates;
	};

/**
 * The env-wired matcher deps for the running backend/worker. The semantic side
 * is built lazily so a literal-only preview never constructs it.
 */
export const buildOrganizeMatchDeps = (
	client: RemitClient,
): OrganizeMatchDeps => ({
	semantic: buildSemanticFromEnv,
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
}

/**
 * Apply the back-apply action to every matched message, reusing the index-time
 * apply plumbing: an idempotent MessageLabel upsert (additive) with
 * `appliedByFilterId` deliberately ABSENT — this path attributes to no filter,
 * exactly like a hand-applied label (RFC 034 Decision 3.3) — and an idempotent
 * folder move (exclusive). One poisoned message never fails the batch; it is
 * counted as failed and the pass continues.
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

	const applyToMessage = async (messageId: string): Promise<void> => {
		if (applyLabel) {
			await client.messageLabel.apply({
				messageId,
				labelId: predicate.actionLabelId,
				accountConfigId,
			});
		}
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
			await moveService.moveMessage(
				accountConfigId,
				messageId,
				predicate.actionMailboxId,
				accountId,
			);
		}
	};

	let applied = 0;
	let failed = 0;
	for (const messageId of messageIds) {
		// Per-message isolation: one poisoned message is counted and skipped, the
		// pass continues. `.catch()` (not a block try/catch) keeps this inside the
		// no-silent-catch ban.
		const ok = await applyToMessage(messageId)
			.then(() => true)
			.catch(() => false);
		if (ok) {
			applied += 1;
		} else {
			failed += 1;
		}
	}
	return { applied, failed };
};
