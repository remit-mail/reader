import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FilterAnchorItem, FilterItem } from "@remit/data-ports";
import { BadRequestError, NotFoundError } from "@remit/data-ports/errors";
import { FilterMatchOperator, FilterState } from "@remit/domain-enums";
import type {
	AnchorPayload,
	ChunkMetadata,
	VectorRecord,
} from "@remit/search-service";
import { createMemoryVectorStore } from "@remit/search-service";
import type { RemitClient } from "./data-client.js";
import {
	applyOrganize,
	matchOrganize,
	type OrganizeCandidate,
	type OrganizeMatchDeps,
	type OrganizePredicate,
} from "./organize.js";
import { _resetSemanticCapabilityForTest } from "./semantic-capability.js";

const moduleNotFound = (): Error => {
	const error = new Error("Cannot find package 'sqlite-vec' imported from …");
	(error as Error & { code: string }).code = "ERR_MODULE_NOT_FOUND";
	return error;
};

const ACCOUNT_CONFIG_ID = "cfg-1";
const ANCHOR_VECTOR = [1, 0, 0, 0];
const ORTHOGONAL_VECTOR = [0, 1, 0, 0];

const anchorPayload: AnchorPayload = {
	anchorEmbedding: ANCHOR_VECTOR,
	anchorEmbeddingId: "test-model@4",
	anchorSourceText: "book me a table",
};

const metadata = (over: Partial<ChunkMetadata>): ChunkMetadata => ({
	messageId: "msg-x",
	threadId: "thread-x",
	accountConfigId: ACCOUNT_CONFIG_ID,
	mailboxIds: ["mbox-1"],
	chunkType: "body",
	sentDate: 1_700_000_000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	...over,
});

const bodyChunk = (
	messageId: string,
	vector: number[],
	over: Partial<ChunkMetadata> = {},
): VectorRecord => ({
	chunkId: `${messageId}#body`,
	vector,
	metadata: metadata({ messageId, ...over }),
});

const predicate = (
	over: Partial<OrganizePredicate> = {},
): OrganizePredicate => ({
	anchorMessageId: "msg-anchor",
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	similarityThreshold: 0.75,
	actionLabelId: "None",
	actionMailboxId: "None",
	...over,
});

/** A standing filter fixture — the "other" filters the precedence check reads. */
const filterItem = (over: Partial<FilterItem> = {}): FilterItem => ({
	filterId: "filter-other",
	accountConfigId: ACCOUNT_CONFIG_ID,
	name: "other filter",
	scope: "Standing",
	state: FilterState.Active,
	hasAnchor: false,
	ruleChangedAt: 0,
	actionChangedAt: 0,
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	createdAt: 0,
	updatedAt: 0,
	...over,
});

/**
 * A client that records MessageLabel writes and blows up if the back-apply path
 * ever touches Filter/FilterAnchor — the RFC 034 guardrail: this scope never
 * persists a standing rule.
 *
 * `activeFilters`/`filterAnchorRows`/`threadMessages` model the account's
 * *other*, already-existing standing filters and message rows the exclusive-
 * move precedence check (reader #350) reads — empty by default, so every
 * existing test (which never seeded a competing filter) is unaffected and the
 * precedence check is a same-length no-op.
 */
const trackingClient = (
	seed: {
		activeFilters?: FilterItem[];
		filterAnchorRows?: FilterAnchorItem[];
		threadMessages?: Record<
			string,
			{ fromEmail?: string; fromName?: string; subject?: string }
		>;
	} = {},
) => {
	const labeled: Array<{ messageId: string; labelId: string }> = [];
	let filterWrites = 0;
	let filterAnchorWrites = 0;
	const activeFilters = seed.activeFilters ?? [];
	const filterAnchorRows = seed.filterAnchorRows ?? [];
	const threadMessages = seed.threadMessages ?? {};
	const client = {
		messageLabel: {
			apply: async (input: {
				messageId: string;
				labelId: string;
				accountConfigId: string;
				appliedByFilterId?: string;
			}) => {
				assert.equal(
					input.appliedByFilterId,
					undefined,
					"back-apply must never attribute a filter",
				);
				labeled.push({ messageId: input.messageId, labelId: input.labelId });
				return {} as never;
			},
		},
		message: {
			get: async (messageId: string) => ({ messageId, mailboxId: "mbox-src" }),
		},
		mailbox: {
			resolveAccountId: async () => "acct-1",
		},
		threadMessage: {
			get: async (_accountConfigId: string, messageId: string) => {
				const row = threadMessages[messageId];
				if (!row) {
					throw new NotFoundError("ThreadMessage not found");
				}
				return {
					threadMessageId: messageId,
					fromEmail: row.fromEmail,
					fromName: row.fromName,
					subject: row.subject,
				} as never;
			},
		},
		filter: {
			create: async () => {
				filterWrites += 1;
				return {} as never;
			},
			listByAccountAndState: async () => activeFilters,
			refreshExpiry: async (filter: FilterItem) => filter,
		},
		filterAnchor: {
			put: async () => {
				filterAnchorWrites += 1;
				return {} as never;
			},
			get: async (_accountConfigId: string, filterId: string) =>
				filterAnchorRows.find((row) => row.filterId === filterId) ?? null,
			listByAccountConfig: async () => filterAnchorRows,
		},
	} as unknown as RemitClient;
	return {
		client,
		labeled,
		filterWrites: () => filterWrites,
		filterAnchorWrites: () => filterAnchorWrites,
	};
};

/**
 * A stand-in for the local-first placement mover. `moveMessage` is idempotent
 * on the (messageId, destination) pair — mirroring the real
 * `PlacementMoveService` marker engine (#1297) — so a redelivered back-apply
 * re-issues the same move without double-enqueuing. Records every call and the
 * final resting mailbox per message.
 */
const trackingMoveService = () => {
	const moves: Array<{
		messageId: string;
		destinationMailboxId: string;
		accountId: string;
	}> = [];
	const destinationOf = new Map<string, string>();
	let enqueues = 0;
	return {
		moveService: {
			moveMessage: async (
				_accountConfigId: string,
				messageId: string,
				destinationMailboxId: string,
				accountId: string,
			): Promise<void> => {
				moves.push({ messageId, destinationMailboxId, accountId });
				if (destinationOf.get(messageId) === destinationMailboxId) return;
				destinationOf.set(messageId, destinationMailboxId);
				enqueues += 1;
			},
		} as unknown as import("@remit/mailbox-service").PlacementMoveService,
		moves,
		enqueues: () => enqueues,
		destinations: () => destinationOf,
	};
};

/**
 * Deps whose semantic side is the in-memory vector store — the vector-backed
 * deployment. `listAccountFilterMessages` returns the given corpus (empty by
 * default), and constructing the semantic side is tracked so a literal-only
 * predicate can be shown never to build it. `filterAnchorRows` seeds the
 * account's *persisted* FilterAnchor rows (empty by default) — the reverse
 * lookup back-apply's anchor consultation reads (reader #350) — and `embed`
 * is a deterministic stand-in for the configured embedding model, used only
 * by the exclusive-move precedence check.
 */
const matchDeps = (
	store: ReturnType<typeof createMemoryVectorStore>,
	corpus: OrganizeCandidate[] = [],
	filterAnchorRows: FilterAnchorItem[] = [],
): OrganizeMatchDeps & { semanticBuilds: () => number } => {
	let semanticBuilds = 0;
	return {
		semantic: () => {
			semanticBuilds += 1;
			return {
				buildAnchor: async () => anchorPayload,
				vectorStore: store,
				embed: async (text: string) =>
					text.includes("reservation") ? ANCHOR_VECTOR : ORTHOGONAL_VECTOR,
			};
		},
		listAccountFilterMessages: async () => corpus,
		filterAnchors: { listByAccountConfig: async () => filterAnchorRows },
		semanticBuilds: () => semanticBuilds,
	};
};

/**
 * Deps modelling a deployment that ships no vector pipeline: any attempt to
 * build or use the semantic side raises the missing-module shape, and the
 * literal corpus is served from plain rows.
 */
const vectorlessDeps = (
	corpus: OrganizeCandidate[],
): OrganizeMatchDeps & { semanticUsed: () => boolean } => {
	let semanticUsed = false;
	return {
		semantic: () => {
			semanticUsed = true;
			return {
				buildAnchor: async () => {
					throw moduleNotFound();
				},
				vectorStore: {
					query: async () => {
						throw moduleNotFound();
					},
					getByMessage: async () => {
						throw moduleNotFound();
					},
				},
				embed: async () => {
					throw moduleNotFound();
				},
			};
		},
		listAccountFilterMessages: async () => corpus,
		filterAnchors: { listByAccountConfig: async () => [] },
		semanticUsed: () => semanticUsed,
	};
};

const candidate = (
	messageId: string,
	over: Partial<OrganizeCandidate["message"]> = {},
): OrganizeCandidate => ({
	messageId,
	message: {
		from: "",
		fromName: "",
		subject: "",
		text: "",
		listId: "",
		...over,
	},
});

describe("matchOrganize", () => {
	it("returns every semantically matching message and excludes the misses", async () => {
		const store = createMemoryVectorStore();
		const matching = ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"];
		await store.upsert([
			...matching.map((id) => bodyChunk(id, ANCHOR_VECTOR)),
			bodyChunk("msg-miss", ORTHOGONAL_VECTOR),
		]);

		const { messageIds, semanticUnavailable } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			predicate({ actionLabelId: "lbl-1" }),
		);

		assert.deepEqual([...messageIds].sort(), matching);
		assert.equal(semanticUnavailable, false);
	});

	it("matches nothing when the predicate has neither an anchor nor a clause", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);

		const { messageIds } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			{
				...predicate(),
				anchorMessageId: "None",
			},
		);

		assert.deepEqual(messageIds, []);
	});

	it("refines the semantic set by literal clauses", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([
			bodyChunk("msg-1", ANCHOR_VECTOR, {
				subject: "Dinner reservation",
				textPreview: "your table is booked",
			}),
			bodyChunk("msg-2", ANCHOR_VECTOR, {
				subject: "Newsletter",
				textPreview: "weekly digest",
			}),
		]);

		const { messageIds } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			{
				...predicate(),
				literalClauses: [{ field: "Subject", value: "reservation" }],
			},
		);

		assert.deepEqual(messageIds, ["msg-1"]);
	});

	it("never builds the semantic side for a purely-literal predicate", async () => {
		const store = createMemoryVectorStore();
		const deps = matchDeps(store, [
			candidate("msg-1", { subject: "Dinner reservation" }),
			candidate("msg-2", { subject: "Newsletter" }),
		]);

		const { messageIds } = await matchOrganize(deps, ACCOUNT_CONFIG_ID, {
			...predicate(),
			anchorMessageId: "None",
			literalClauses: [{ field: "Subject", value: "reservation" }],
		});

		assert.deepEqual(messageIds, ["msg-1"]);
		assert.equal(
			deps.semanticBuilds(),
			0,
			"a literal-only predicate must not construct the vector-backed side",
		);
	});
});

describe("matchOrganize honors the persisted FilterAnchor (reader #350)", () => {
	it("still matches by reading the persisted anchor after the anchor message is purged", async () => {
		const store = createMemoryVectorStore();
		const matching = ["msg-1", "msg-2"];
		await store.upsert([
			...matching.map((id) => bodyChunk(id, ANCHOR_VECTOR)),
			bodyChunk("msg-miss", ORTHOGONAL_VECTOR),
		]);

		const persistedAnchor: FilterAnchorItem = {
			accountConfigId: ACCOUNT_CONFIG_ID,
			filterId: "filter-a",
			anchorEmbedding: ANCHOR_VECTOR,
			anchorEmbeddingId: "test-model@4",
			anchorSourceText: "book me a table",
			anchorMessageId: "msg-anchor",
			createdAt: 0,
			updatedAt: 0,
		};

		let buildAnchorCalls = 0;
		const deps: OrganizeMatchDeps = {
			semantic: () => ({
				buildAnchor: async () => {
					// The live path: the anchor message's chunks are gone (purged),
					// exactly what buildMessageAnchor returns in that case today.
					buildAnchorCalls += 1;
					return null;
				},
				vectorStore: store,
				embed: async () => ANCHOR_VECTOR,
			}),
			listAccountFilterMessages: async () => [],
			filterAnchors: { listByAccountConfig: async () => [persistedAnchor] },
		};

		const { messageIds } = await matchOrganize(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate(),
		);

		assert.deepEqual(
			[...messageIds].sort(),
			matching,
			"the persisted anchor vector still finds the same matches the live message would have",
		);
		assert.equal(
			buildAnchorCalls,
			0,
			"a persisted anchor must be read instead of re-deriving one from the (now-gone) live message",
		);
	});

	it("falls back to deriving the anchor from the live message when no filter was ever anchored on it", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);

		// No persisted FilterAnchor names this anchorMessageId — an ad hoc "all
		// like these" widen over a bare message selection, never tied to a
		// standing filter.
		const { messageIds } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			predicate(),
		);

		assert.deepEqual(messageIds, ["msg-1"]);
	});
});

describe("matchOrganize on a deployment without the vector pipeline", () => {
	const ORIGINAL = process.env.DATA_BACKEND;
	beforeEach(() => {
		process.env.DATA_BACKEND = "sqlite";
		_resetSemanticCapabilityForTest();
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.DATA_BACKEND;
		else process.env.DATA_BACKEND = ORIGINAL;
		_resetSemanticCapabilityForTest();
	});

	it("matches a literal predicate from the corpus without touching the vector store", async () => {
		const deps = vectorlessDeps([
			candidate("msg-1", { subject: "Dinner reservation" }),
			candidate("msg-2", { subject: "Weekly newsletter" }),
			candidate("msg-3", { subject: "Table reservation confirmed" }),
		]);

		const { messageIds, semanticUnavailable } = await matchOrganize(
			deps,
			ACCOUNT_CONFIG_ID,
			{
				...predicate(),
				anchorMessageId: "None",
				literalClauses: [{ field: "Subject", value: "reservation" }],
			},
		);

		assert.deepEqual(messageIds, ["msg-1", "msg-3"]);
		assert.equal(semanticUnavailable, false);
		assert.equal(
			deps.semanticUsed(),
			false,
			"a literal-only predicate must never reach the vector store",
		);
	});

	it("rejects a body-content (HasWords) clause as a 400 rather than matching it against a preview", async () => {
		const deps = vectorlessDeps([
			candidate("msg-1", { subject: "Dinner reservation" }),
		]);

		await assert.rejects(
			() =>
				matchOrganize(deps, ACCOUNT_CONFIG_ID, {
					...predicate(),
					anchorMessageId: "None",
					literalClauses: [{ field: "HasWords", value: "invoice" }],
				}),
			(error: unknown) => {
				assert.ok(error instanceof BadRequestError);
				assert.equal(error.statusCode, 400);
				assert.match(error.message, /HasWords/);
				return true;
			},
			"the vector-free literal path must not silently narrow a body match to a preview",
		);
		assert.equal(deps.semanticUsed(), false);
	});

	it("degrades an anchor+clauses widen to the literal matches, flagged, instead of crashing", async () => {
		const deps = vectorlessDeps([
			candidate("msg-1", { subject: "Dinner reservation" }),
			candidate("msg-2", { subject: "Weekly newsletter" }),
		]);

		const { messageIds, semanticUnavailable } = await matchOrganize(
			deps,
			ACCOUNT_CONFIG_ID,
			{
				...predicate(),
				literalClauses: [{ field: "Subject", value: "reservation" }],
			},
		);

		assert.deepEqual(messageIds, ["msg-1"]);
		assert.equal(semanticUnavailable, true);
	});

	it("degrades an anchor-only widen to an empty flagged result instead of crashing", async () => {
		const deps = vectorlessDeps([candidate("msg-1"), candidate("msg-2")]);

		const { messageIds, semanticUnavailable } = await matchOrganize(
			deps,
			ACCOUNT_CONFIG_ID,
			predicate(),
		);

		assert.deepEqual(messageIds, []);
		assert.equal(semanticUnavailable, true);
	});

	it("propagates a genuine (non-capability) semantic failure loudly", async () => {
		const deps: OrganizeMatchDeps = {
			semantic: () => ({
				buildAnchor: async () => {
					throw new Error("SQLITE_BUSY");
				},
				vectorStore: {
					query: async () => [],
					getByMessage: async () => [],
				},
				embed: async () => [],
			}),
			listAccountFilterMessages: async () => [],
			filterAnchors: { listByAccountConfig: async () => [] },
		};

		await assert.rejects(
			() => matchOrganize(deps, ACCOUNT_CONFIG_ID, predicate()),
			/SQLITE_BUSY/,
		);
	});
});

describe("back-apply pipeline (matchOrganize -> applyOrganize)", () => {
	it("applies the label to all N matches in one pass and writes zero Filter rows", async () => {
		const store = createMemoryVectorStore();
		const matching = ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"];
		await store.upsert([
			...matching.map((id) => bodyChunk(id, ANCHOR_VECTOR)),
			bodyChunk("msg-miss", ORTHOGONAL_VECTOR),
		]);

		const p = predicate({ actionLabelId: "lbl-1" });

		// The preview and the apply share the same matcher — the previewed set is
		// exactly what gets applied.
		const previewed = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const applied = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, p);
		assert.deepEqual(previewed, applied);

		const tracked = trackingClient();
		const result = await applyOrganize(
			{ client: tracked.client, match: matchDeps(store) },
			ACCOUNT_CONFIG_ID,
			applied.messageIds,
			p,
		);

		assert.equal(result.applied, matching.length);
		assert.equal(result.failed, 0);
		assert.deepEqual(
			tracked.labeled.map((row) => row.messageId).sort(),
			matching,
		);
		assert.ok(
			tracked.labeled.every((row) => row.labelId === "lbl-1"),
			"every matching message gets the requested label",
		);
		assert.equal(tracked.filterWrites(), 0, "no Filter row is ever created");
		assert.equal(
			tracked.filterAnchorWrites(),
			0,
			"no FilterAnchor row is ever created",
		);
	});

	it("counts a requested move as failed when no move service is wired", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);
		const p = predicate({ actionMailboxId: "mbox-target" });

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const result = await applyOrganize(
			{ client: tracked.client, match: matchDeps(store) },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, 0);
		assert.equal(result.failed, 1);
	});

	it("moves every match through the wired move service and writes zero Filter rows", async () => {
		const store = createMemoryVectorStore();
		const matching = ["msg-1", "msg-2", "msg-3"];
		await store.upsert([
			...matching.map((id) => bodyChunk(id, ANCHOR_VECTOR)),
			bodyChunk("msg-miss", ORTHOGONAL_VECTOR),
		]);
		const p = predicate({ actionMailboxId: "mbox-target" });

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, matching.length);
		assert.equal(result.failed, 0);
		assert.deepEqual(
			mover.moves.map((m) => m.messageId).sort(),
			matching,
			"every matched message is moved once",
		);
		assert.ok(
			mover.moves.every((m) => m.destinationMailboxId === "mbox-target"),
			"every move targets the requested mailbox",
		);
		assert.equal(
			tracked.labeled.length,
			0,
			"a move-only action applies no label",
		);
		assert.equal(tracked.filterWrites(), 0, "no Filter row is ever created");
		assert.equal(
			tracked.filterAnchorWrites(),
			0,
			"no FilterAnchor row is ever created",
		);
	});

	it("applies both a label and a move when both actions are requested", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);
		const p = predicate({
			actionLabelId: "lbl-1",
			actionMailboxId: "mbox-target",
		});

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, 1);
		assert.equal(result.failed, 0);
		assert.deepEqual(tracked.labeled, [
			{ messageId: "msg-1", labelId: "lbl-1" },
		]);
		assert.deepEqual(
			mover.moves.map((m) => m.messageId),
			["msg-1"],
		);
	});

	it("is idempotent on redelivery: a re-run re-issues the same move without double-enqueuing", async () => {
		const store = createMemoryVectorStore();
		const matching = ["msg-1", "msg-2"];
		await store.upsert(matching.map((id) => bodyChunk(id, ANCHOR_VECTOR)));
		const p = predicate({ actionMailboxId: "mbox-target" });

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient();
		const mover = trackingMoveService();

		const first = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);
		const second = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(first.applied, matching.length);
		assert.equal(second.applied, matching.length);
		assert.equal(
			mover.enqueues(),
			matching.length,
			"the second pass drives the marker forward without a fresh enqueue",
		);
		assert.deepEqual(
			[...mover.destinations().entries()].sort(),
			matching.map((id): [string, string] => [id, "mbox-target"]),
			"each message rests in the requested mailbox exactly once",
		);
	});
});

describe("applyOrganize resolves move precedence against current Active filters (reader #350)", () => {
	it("suppresses an out-ranked move but still applies the label", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);
		// The back-applied filter — "move to mbox-old" — is out-ranked by a
		// more-recently-changed standing filter that currently claims msg-1 for a
		// different destination.
		const p = predicate({
			actionLabelId: "lbl-1",
			actionMailboxId: "mbox-old",
		});
		const newerFilter = filterItem({
			filterId: "filter-newer",
			ruleChangedAt: 1_000,
			actionChangedAt: 1_000,
			actionMailboxId: "mbox-new",
			literalClauses: [{ field: "Subject", value: "reservation" }],
		});

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient({
			activeFilters: [newerFilter],
			threadMessages: { "msg-1": { subject: "Dinner reservation" } },
		});
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, 1, "a suppressed move is not a failure");
		assert.equal(result.failed, 0);
		assert.deepEqual(
			tracked.labeled,
			[{ messageId: "msg-1", labelId: "lbl-1" }],
			"the additive label still applies even though the move is suppressed",
		);
		assert.deepEqual(
			mover.moves,
			[],
			"the exclusive move is skipped in favor of the newer filter's own move",
		);
	});

	it("moves the message when no other Active filter currently outranks it", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);
		const p = predicate({ actionMailboxId: "mbox-target" });
		// A different standing filter matches this message too, but agrees on the
		// same destination — nothing to defer to.
		const agreeingFilter = filterItem({
			filterId: "filter-agrees",
			ruleChangedAt: 1_000,
			actionChangedAt: 1_000,
			actionMailboxId: "mbox-target",
			literalClauses: [{ field: "Subject", value: "reservation" }],
		});

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient({
			activeFilters: [agreeingFilter],
			threadMessages: { "msg-1": { subject: "Dinner reservation" } },
		});
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, 1);
		assert.equal(result.failed, 0);
		assert.deepEqual(
			mover.moves.map((m) => m.messageId),
			["msg-1"],
			"the move proceeds exactly as it would have before this check existed",
		);
	});

	it("suppresses an out-ranked move by a newer *semantic* filter's persisted anchor", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);
		const p = predicate({ actionMailboxId: "mbox-old" });
		const newerSemanticFilter = filterItem({
			filterId: "filter-newer-semantic",
			ruleChangedAt: 1_000,
			actionChangedAt: 1_000,
			actionMailboxId: "mbox-new",
			hasAnchor: true,
		});
		const persistedAnchor: FilterAnchorItem = {
			accountConfigId: ACCOUNT_CONFIG_ID,
			filterId: "filter-newer-semantic",
			anchorEmbedding: ANCHOR_VECTOR,
			anchorEmbeddingId: "test-model@4",
			anchorSourceText: "book me a table",
			anchorMessageId: "msg-anchor-2",
			createdAt: 0,
			updatedAt: 0,
		};

		const { messageIds: matched } = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			p,
		);
		const tracked = trackingClient({
			activeFilters: [newerSemanticFilter],
			filterAnchorRows: [persistedAnchor],
			threadMessages: { "msg-1": { subject: "Dinner reservation" } },
		});
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{
				client: tracked.client,
				moveService: mover.moveService,
				match: matchDeps(store, [], [persistedAnchor]),
			},
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);

		assert.equal(result.applied, 1);
		assert.deepEqual(
			mover.moves,
			[],
			"a newer semantic filter's own persisted anchor outranks the move",
		);
	});
});

describe("matchOrganize with ListId and FromDomain clauses", () => {
	const senderChunk = (
		messageId: string,
		fromEmail: string,
		over: Partial<ChunkMetadata> = {},
	): VectorRecord => ({
		chunkId: `${messageId}#sender`,
		vector: ANCHOR_VECTOR,
		metadata: metadata({
			messageId,
			chunkType: "sender",
			textPreview: fromEmail,
			...over,
		}),
	});

	it("matches a ListId clause exactly off the vector-free projection", async () => {
		const deps = vectorlessDeps([
			candidate("msg-1", { listId: "weekly.news.example.com" }),
			candidate("msg-2", { listId: "news.example.com" }),
			candidate("msg-3", {}),
		]);

		const { messageIds } = await matchOrganize(deps, ACCOUNT_CONFIG_ID, {
			...predicate(),
			anchorMessageId: "None",
			literalClauses: [{ field: "ListId", value: "weekly.news.example.com" }],
		});

		assert.deepEqual(messageIds, ["msg-1"]);
	});

	it("matches a FromDomain clause public-suffix aware off the vector-free projection", async () => {
		const deps = vectorlessDeps([
			candidate("msg-1", { from: "notifications@github.com" }),
			candidate("msg-2", { from: "ci@sub.github.com" }),
			candidate("msg-3", { from: "attacker@github.com.evil.example" }),
		]);

		const { messageIds } = await matchOrganize(deps, ACCOUNT_CONFIG_ID, {
			...predicate(),
			anchorMessageId: "None",
			literalClauses: [{ field: "FromDomain", value: "github.com" }],
		});

		assert.deepEqual(messageIds, ["msg-1", "msg-2"]);
	});

	it("round-trips ListId and FromDomain through the semantic-arm chunk projection", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([
			senderChunk("msg-1", "ci@github.com", {
				listId: "actions.github.com",
			}),
			bodyChunk("msg-1", ANCHOR_VECTOR, { listId: "actions.github.com" }),
			senderChunk("msg-2", "hi@othersender.example", {
				listId: "other.list.example",
			}),
			bodyChunk("msg-2", ANCHOR_VECTOR, { listId: "other.list.example" }),
		]);

		const byListId = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, {
			...predicate(),
			literalClauses: [{ field: "ListId", value: "actions.github.com" }],
		});
		assert.deepEqual(byListId.messageIds, ["msg-1"]);

		const byFromDomain = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			{
				...predicate(),
				literalClauses: [{ field: "FromDomain", value: "github.com" }],
			},
		);
		assert.deepEqual(byFromDomain.messageIds, ["msg-1"]);
	});

	it("applies a ListId predicate to exactly the previewed set (preview == apply)", async () => {
		const deps = vectorlessDeps([
			candidate("msg-1", { listId: "weekly.news.example.com" }),
			candidate("msg-2", { listId: "weekly.news.example.com" }),
			candidate("msg-3", { listId: "other.example.com" }),
		]);
		const p = predicate({
			anchorMessageId: "None",
			actionLabelId: "lbl-list",
			literalClauses: [{ field: "ListId", value: "weekly.news.example.com" }],
		});

		const previewed = await matchOrganize(deps, ACCOUNT_CONFIG_ID, p);
		const applied = await matchOrganize(deps, ACCOUNT_CONFIG_ID, p);
		assert.deepEqual(previewed, applied);
		assert.deepEqual(previewed.messageIds, ["msg-1", "msg-2"]);

		const tracked = trackingClient();
		const result = await applyOrganize(
			{ client: tracked.client, match: deps },
			ACCOUNT_CONFIG_ID,
			applied.messageIds,
			p,
		);

		assert.equal(result.applied, 2);
		assert.equal(result.failed, 0);
		assert.deepEqual(tracked.labeled.map((row) => row.messageId).sort(), [
			"msg-1",
			"msg-2",
		]);
	});
});
