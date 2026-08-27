import { inspect } from "node:util";
import type {
	FilterAnchorItem,
	FilterItem,
	IFilterAnchorRepository,
	OrganizeJobRequestItem,
} from "@remit/data-ports";
import { FilterClauseField } from "@remit/domain-enums";
import { logger } from "@remit/logger-lambda";
import {
	DEFAULT_SEMANTIC_MATCH_THRESHOLD,
	type FilterMessage,
	literalClausesMatch,
	NO_ACTION,
	PlacementMoveService,
	refreshAnchorForEmbedder,
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
import type { RemitClient } from "./data-client.js";
import {
	isSemanticCapabilityAbsence,
	noteSemanticCapabilityAbsence,
} from "./semantic-capability.js";

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
	/**
	 * Embed one text — the `AnchorEmbedder` half of these deps, used to
	 * re-embed a drifted persisted anchor in place ({@link
	 * refreshAnchorForEmbedder}). Never called by the anchor widen itself,
	 * which only ever runs a vector-store kNN read (see
	 * `semantic-capability.ts`).
	 */
	embed: (text: string) => Promise<number[]>;
	/**
	 * The configured model's `<modelId>@<dimensions>` id, compared against a
	 * persisted anchor's `anchorEmbeddingId` to catch a same-dimension model
	 * swap that would otherwise score a current-model vector against a
	 * stale-model anchor (RFC 039 Decision 1a, reader #399).
	 */
	readonly embeddingId: string;
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
	/**
	 * Every persisted FilterAnchor for the account — read-only, always
	 * available (never gated behind {@link semantic}, since it never touches
	 * the vector store). A back-apply predicate carries only a bare
	 * `anchorMessageId`, never a `filterId` (RFC 034 recap: this job is
	 * deliberately not a Filter), so this is how {@link matchSemantic} finds
	 * "the standing filter this anchor came from," if one still exists, to
	 * read its fixed-at-save-time vector instead of re-deriving one from the
	 * anchor message's current chunks (reader #350 / RFC 039 Decision 1).
	 * `put` is the write half of the lazy anchor-drift repair
	 * ({@link refreshAnchorForEmbedder}), never a new standing rule.
	 */
	filterAnchors: Pick<IFilterAnchorRepository, "listByAccountConfig" | "put">;
}

/**
 * Why the matcher refused a predicate. A refusal is an expected outcome of
 * asking for a rule this deployment cannot evaluate, not a fault: the HTTP
 * boundary words it as a 400 and the back-apply worker fails the job row on it,
 * neither of which may treat it as the infrastructure failure a throw would
 * make it (reader #463).
 */
export interface OrganizeRejection {
	reason: "BodyContentWithoutVectorPipeline";
	message: string;
}

/** The matched ids plus whether the semantic widen was skipped as unavailable. */
export interface OrganizeMatched {
	rejected: null;
	messageIds: string[];
	semanticUnavailable: boolean;
}

/** The predicate was refused: nothing matched, and nothing may be applied. */
export interface OrganizeMatchRejected {
	rejected: OrganizeRejection;
}

export type OrganizeMatchResult = OrganizeMatched | OrganizeMatchRejected;

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
 * The persisted FilterAnchor whose `anchorMessageId` matches this predicate's
 * anchor, if the account has a standing filter built from that message (RFC
 * 034 Decision 2 / RFC 039 Decision 1, reader #350). A back-apply predicate
 * never carries a `filterId` — this job structurally is not a Filter — so the
 * only way to recover "the filter this anchor came from" is by the value it
 * was anchored on. The scan is over one account's (small, bounded) anchor
 * rows, read-only, and never touches the vector store. Returns `undefined`
 * when no standing filter was ever anchored on this message (or it has since
 * been deleted), in which case the caller falls back to deriving the anchor
 * live from the message's current chunk vectors, exactly as before. The whole
 * row is returned, not just its payload, so the caller can run the same
 * anchor-drift repair index-time matching does.
 */
const findPersistedAnchor = async (
	filterAnchors: Pick<IFilterAnchorRepository, "listByAccountConfig">,
	accountConfigId: string,
	anchorMessageId: string,
): Promise<FilterAnchorItem | undefined> =>
	(await filterAnchors.listByAccountConfig(accountConfigId)).find(
		(anchor) => anchor.anchorMessageId === anchorMessageId,
	);

/**
 * The anchor the widen queries with: the persisted row, re-embedded in place
 * when the embedding model has drifted since it was written. A deployment that
 * ships no embedding model cannot repair it, and the kNN read itself needs
 * none, so that case keeps querying with the stored vector rather than going
 * dark — and is classified without recording the absence, which would
 * otherwise disable every later `/search/semantic` (see
 * `semantic-capability.ts`).
 *
 * The classifier is wider than a missing embedder: `LocalEmbeddingService`
 * raises ERR_EMBEDDING_MODEL_UNAVAILABLE for anything that stops the pipeline
 * loading, a corrupt model file included, and a write failure carrying one of
 * those codes lands here too. Any of them falls back to the stale vector, so
 * the fallback is logged — it is the wrong-score condition this repair exists
 * to close, taken deliberately over returning nothing. Every other failure
 * propagates.
 */
const anchorForWiden = async (
	deps: OrganizeMatchDeps,
	semantic: OrganizeSemanticDeps,
	persisted: FilterAnchorItem,
): Promise<FilterAnchorItem> =>
	refreshAnchorForEmbedder(
		{ anchorRepository: deps.filterAnchors, embedder: semantic },
		persisted,
	).catch((error: unknown) => {
		if (!isSemanticCapabilityAbsence(error)) throw error;
		logger.warn(
			{
				alert: "filter_anchor_repair_unavailable",
				filterId: persisted.filterId,
				accountConfigId: persisted.accountConfigId,
				errorName: (error as { name?: string })?.name,
				error: inspect(error),
			},
			"Cannot re-embed a drifted anchor in this deployment; widening on the stored (previous-model) vector rather than returning nothing",
		);
		return persisted;
	});

/**
 * The semantic (anchor) arm: read the anchor vector — the persisted
 * `FilterAnchor` for a message a standing filter was built from (fixed at
 * save time, unaffected by the anchor message's later deletion or
 * re-chunking, and re-embedded in place when the embedding model has drifted
 * since — {@link refreshAnchorForEmbedder}), or else pool it fresh from the
 * anchor message's existing chunk vectors, the same as before this filter
 * existed or ever had one.
 * Fan out with a k-NN query gated on the cosine threshold, then refine by
 * literal clauses reconstructed from the same chunk vectors. Every read here
 * goes through the vector store; a deployment without the vector pipeline
 * fails on the first call, which {@link matchOrganize} catches. Returns null
 * when neither a persisted anchor nor the message's own chunk vectors exist
 * to pool.
 */
const matchSemantic = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number,
): Promise<string[] | null> => {
	const semantic = deps.semantic();
	const persisted = await findPersistedAnchor(
		deps.filterAnchors,
		accountConfigId,
		predicate.anchorMessageId,
	);
	const anchor: AnchorPayload | null = persisted
		? await anchorForWiden(deps, semantic, persisted)
		: await semantic.buildAnchor(accountConfigId, predicate.anchorMessageId);
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
 * body-content clause reaching the vector-free path is refused instead of
 * returning a wrong set.
 */
export const BODY_CONTENT_REJECTION_MESSAGE =
	"Organize literal matching cannot evaluate a body-content (HasWords) clause without the vector pipeline — it requires the semantic widen path";

const bodyContentRejection = (
	clauses: OrganizePredicate["literalClauses"],
): OrganizeRejection | null =>
	clauses.some((clause) => clause.field === FilterClauseField.HasWords)
		? {
				reason: "BodyContentWithoutVectorPipeline",
				message: BODY_CONTENT_REJECTION_MESSAGE,
			}
		: null;

/**
 * The refusal a predicate carries on its own, decidable without reading the
 * corpus: an anchorless predicate can only ever take the vector-free literal
 * path, so a body-content clause on it is refused up front. `createOrganizeJob`
 * runs this before enqueueing and {@link matchOrganize} runs it on the
 * anchorless arm, so preview, the worker and the request boundary all refuse the
 * same rule (reader #463).
 */
export const organizePredicateRejection = (
	predicate: OrganizePredicate,
): OrganizeRejection | null =>
	hasAnchor(predicate) ? null : bodyContentRejection(predicate.literalClauses);

/**
 * The literal-only arm: scan a bounded, vector-free slice of the corpus and keep
 * the messages whose literal clauses match. Used both for a purely-literal
 * predicate and as the degraded fallback when a widen is requested on a
 * deployment without the vector pipeline. Serves `From`/`Subject` clauses at
 * full fidelity from the core thread rows; body-content (`HasWords`) clauses are
 * refused before this runs (see {@link bodyContentRejection}).
 */
const matchLiteral = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number,
): Promise<string[]> => {
	const clauses = predicate.literalClauses;
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
 * - A predicate the vector-free path cannot evaluate (a body-content clause,
 *   see {@link bodyContentRejection}) comes back as a rejection, so a caller
 *   can tell a refused rule from a broken deployment (reader #463).
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
		return { rejected: null, messageIds: [], semanticUnavailable: false };
	}

	if (!anchored) {
		const rejection = organizePredicateRejection(predicate);
		if (rejection) return { rejected: rejection };
		const messageIds = await matchLiteral(
			deps,
			accountConfigId,
			predicate,
			limit,
		);
		return { rejected: null, messageIds, semanticUnavailable: false };
	}

	try {
		const semanticIds = await matchSemantic(
			deps,
			accountConfigId,
			predicate,
			limit,
		);
		return {
			rejected: null,
			messageIds: semanticIds ?? [],
			semanticUnavailable: false,
		};
	} catch (error) {
		if (!noteSemanticCapabilityAbsence(error)) throw error;
		// The widen cannot run on this deployment. Fall back to the literal
		// clauses over the corpus — nothing when the predicate is anchor-only —
		// and flag the absence so the client can say so.
		if (clauses.length === 0) {
			return { rejected: null, messageIds: [], semanticUnavailable: true };
		}
		const rejection = bodyContentRejection(clauses);
		if (rejection) return { rejected: rejection };
		const messageIds = await matchLiteral(
			deps,
			accountConfigId,
			predicate,
			limit,
		);
		return { rejected: null, messageIds, semanticUnavailable: true };
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
		embed: async (text) => (await embedder.embed([text]))[0],
		embeddingId: embedder.embeddingId,
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
 * rejected before this is read (see {@link bodyContentRejection}), so the
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
	filterAnchors: client.filterAnchor,
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
