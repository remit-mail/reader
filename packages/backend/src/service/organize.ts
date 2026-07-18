import type {
	FilterItem,
	OrganizeJobRequestItem,
} from "@remit/data-ports";
import {
	getClient as getRawDynamoClient,
	MessagePlacementMoveService,
} from "@remit/remit-electrodb-service";
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
import { env } from "expect-env";
import type { RemitClient } from "./dynamodb.js";

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

export interface OrganizeMatchDeps {
	buildAnchor: (
		accountConfigId: string,
		anchorMessageId: string,
	) => Promise<AnchorPayload | null>;
	vectorStore: Pick<VectorStoreService, "query" | "getByMessage">;
	listAccountMessageIds: (
		accountConfigId: string,
		limit: number,
	) => Promise<string[]>;
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
	const textParts: string[] = [];
	for (const record of records) {
		const meta = record.metadata;
		if (meta.subject && !subject) subject = meta.subject;
		if (meta.fromName && !fromName) fromName = meta.fromName;
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
	return { from, fromName, subject, text: textParts.join("\n") };
};

/**
 * The matcher shared by preview and apply — the previewed set equals the applied
 * set for the same input. Read-only. Returns the matching message ids, bounded.
 *
 * - Semantic anchor: the anchor vector is pooled transiently from the anchor
 *   message's existing chunk vectors (never a FilterAnchor row), then a k-NN
 *   query fans out to candidate messages gated on the cosine threshold.
 * - Literal clauses (RFC 031) refine the candidate set; a purely-literal
 *   back-apply scans a bounded slice of the corpus instead.
 * - A predicate with neither an anchor nor a clause matches nothing, mirroring
 *   the index-time filter matcher.
 */
export const matchOrganize = async (
	deps: OrganizeMatchDeps,
	accountConfigId: string,
	predicate: OrganizePredicate,
	limit: number = ORGANIZE_MATCH_LIMIT,
): Promise<string[]> => {
	const anchored = hasAnchor(predicate);
	const clauses = predicate.literalClauses;
	if (!anchored && clauses.length === 0) return [];

	let base: string[];
	if (anchored) {
		const anchor = await deps.buildAnchor(
			accountConfigId,
			predicate.anchorMessageId,
		);
		if (!anchor) return [];
		const threshold =
			predicate.similarityThreshold ?? DEFAULT_SEMANTIC_MATCH_THRESHOLD;
		const matches = await deps.vectorStore.query({
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
		base = [...bestScore.entries()]
			.filter(([, score]) => score >= threshold)
			.map(([messageId]) => messageId);
	} else {
		base = await deps.listAccountMessageIds(accountConfigId, limit);
	}

	if (clauses.length === 0) return base.slice(0, limit);

	const matched: string[] = [];
	for (const messageId of base) {
		if (matched.length >= limit) break;
		const records = await deps.vectorStore.getByMessage(messageId);
		const message = filterMessageFromChunks(records);
		if (!message) continue;
		if (literalClausesMatch(clauses, predicate.matchOperator, message)) {
			matched.push(messageId);
		}
	}
	return matched;
};

let cachedVectorStore: Pick<
	VectorStoreService,
	"query" | "getByMessage"
> | null = null;

const getVectorStore = (): Pick<
	VectorStoreService,
	"query" | "getByMessage"
> => {
	if (!cachedVectorStore) {
		const embedder = buildEmbeddingServiceFromEnv();
		cachedVectorStore = buildVectorStoreFromEnv(embedder.dimensions);
	}
	return cachedVectorStore;
};

const buildAnchorFromEnv = (): OrganizeMatchDeps["buildAnchor"] => {
	const embedder = buildEmbeddingServiceFromEnv();
	const store = buildVectorStoreFromEnv(embedder.dimensions);
	return (accountConfigId, anchorMessageId) =>
		buildMessageAnchor(
			{ store, embedder },
			{ accountConfigId, anchorMessageId },
		);
};

/**
 * A bounded corpus slice for a purely-literal back-apply: the account's message
 * ids, gathered mailbox by mailbox and capped. Paginated per mailbox so a large
 * corpus never loads at once.
 */
const listAccountMessageIdsFromClient =
	(client: RemitClient): OrganizeMatchDeps["listAccountMessageIds"] =>
	async (accountConfigId, limit) => {
		const accounts =
			await client.account.listAllByAccountConfig(accountConfigId);
		const ids: string[] = [];
		for (const account of accounts) {
			const mailboxes = await client.mailbox.listAllByAccount(
				account.accountId,
			);
			for (const mailbox of mailboxes) {
				let continuationToken: string | undefined;
				do {
					const page = await client.message.listByMailbox(mailbox.mailboxId, {
						limit,
						continuationToken,
					});
					for (const message of page.items) {
						ids.push(message.messageId);
						if (ids.length >= limit) return ids;
					}
					continuationToken = page.continuationToken;
				} while (continuationToken);
			}
		}
		return ids;
	};

/**
 * The env-wired matcher deps for the running backend/worker. The vector store
 * and embedder are selected by env, independent of `DATA_BACKEND`.
 */
export const buildOrganizeMatchDeps = (
	client: RemitClient,
): OrganizeMatchDeps => ({
	buildAnchor: buildAnchorFromEnv(),
	vectorStore: getVectorStore(),
	listAccountMessageIds: listAccountMessageIdsFromClient(client),
});

let cachedPlacementMarker: MessagePlacementMoveService | null = null;

const getPlacementMarker = (): MessagePlacementMoveService => {
	if (!cachedPlacementMarker) {
		cachedPlacementMarker = new MessagePlacementMoveService({
			client: getRawDynamoClient(),
			table: env.DYNAMODB_TABLE_NAME,
		});
	}
	return cachedPlacementMarker;
};

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
		markerService: getPlacementMarker(),
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
