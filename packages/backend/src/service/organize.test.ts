import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FilterMatchOperator } from "@remit/domain-enums";
import type {
	AnchorPayload,
	ChunkMetadata,
	VectorRecord,
} from "@remit/search-service";
import { createMemoryVectorStore } from "@remit/search-service";
import type { RemitClient } from "./dynamodb.js";
import {
	applyOrganize,
	matchOrganize,
	type OrganizeMatchDeps,
	type OrganizePredicate,
} from "./organize.js";

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

/**
 * A client that records MessageLabel writes and blows up if the back-apply path
 * ever touches Filter/FilterAnchor — the RFC 034 guardrail: this scope never
 * persists a standing rule.
 */
const trackingClient = () => {
	const labeled: Array<{ messageId: string; labelId: string }> = [];
	let filterWrites = 0;
	let filterAnchorWrites = 0;
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
		filter: {
			create: async () => {
				filterWrites += 1;
				return {} as never;
			},
		},
		filterAnchor: {
			put: async () => {
				filterAnchorWrites += 1;
				return {} as never;
			},
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

const matchDeps = (
	store: ReturnType<typeof createMemoryVectorStore>,
): OrganizeMatchDeps => ({
	buildAnchor: async () => anchorPayload,
	vectorStore: store,
	listAccountMessageIds: async () => [],
});

describe("matchOrganize", () => {
	it("returns every semantically matching message and excludes the misses", async () => {
		const store = createMemoryVectorStore();
		const matching = ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"];
		await store.upsert([
			...matching.map((id) => bodyChunk(id, ANCHOR_VECTOR)),
			bodyChunk("msg-miss", ORTHOGONAL_VECTOR),
		]);

		const matched = await matchOrganize(
			matchDeps(store),
			ACCOUNT_CONFIG_ID,
			predicate({ actionLabelId: "lbl-1" }),
		);

		assert.deepEqual([...matched].sort(), matching);
	});

	it("matches nothing when the predicate has neither an anchor nor a clause", async () => {
		const store = createMemoryVectorStore();
		await store.upsert([bodyChunk("msg-1", ANCHOR_VECTOR)]);

		const matched = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, {
			...predicate(),
			anchorMessageId: "None",
		});

		assert.deepEqual(matched, []);
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

		const matched = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, {
			...predicate(),
			literalClauses: [{ field: "Subject", value: "reservation" }],
		});

		assert.deepEqual(matched, ["msg-1"]);
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
			{ client: tracked.client },
			ACCOUNT_CONFIG_ID,
			applied,
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

		const matched = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, p);
		const tracked = trackingClient();
		const result = await applyOrganize(
			{ client: tracked.client },
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

		const matched = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, p);
		const tracked = trackingClient();
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
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

		const matched = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, p);
		const tracked = trackingClient();
		const mover = trackingMoveService();
		const result = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
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

		const matched = await matchOrganize(matchDeps(store), ACCOUNT_CONFIG_ID, p);
		const tracked = trackingClient();
		const mover = trackingMoveService();

		const first = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
			ACCOUNT_CONFIG_ID,
			matched,
			p,
		);
		const second = await applyOrganize(
			{ client: tracked.client, moveService: mover.moveService },
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
