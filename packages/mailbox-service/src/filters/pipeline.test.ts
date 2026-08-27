/**
 * The index-time filter pass over an anchorless literal filter — the shape the
 * organize widen creates on a deployment without the vector pipeline: `From`
 * clauses combined with `Or`, `hasAnchor: false`. This is what keeps a standing
 * "move all mail from these senders" filter working on future mail with no
 * vectors, so it is pinned directly: a matching sender resolves the move, a
 * non-matching one resolves nothing, and the embedder is never touched.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	FilterItem,
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import {
	FilterClauseField,
	FilterMatchOperator,
	FilterState,
} from "@remit/domain-enums";
import type { PlacementMoveService } from "../placement-move.js";
import { NO_ACTION } from "./match.js";
import { type FilterConfig, FilterPipeline } from "./pipeline.js";

const senderFilter = (destinationMailboxId: string): FilterItem =>
	({
		filterId: "flt-senders",
		accountConfigId: "cfg-1",
		name: "npm barrage",
		scope: "Standing",
		state: FilterState.Active,
		hasAnchor: false,
		ruleChangedAt: 1,
		matchOperator: FilterMatchOperator.Or,
		literalClauses: [
			{ field: FilterClauseField.From, value: "npm@github.com" },
			{ field: FilterClauseField.From, value: "notifications@github.com" },
		],
		actionLabelId: NO_ACTION,
		actionMailboxId: destinationMailboxId,
		createdAt: 1,
		updatedAt: 1,
	}) as unknown as FilterItem;

const buildPipeline = (...filters: FilterItem[]) => {
	const state = { embedCalls: 0 };
	const config: FilterConfig = {
		filterService: {
			listByAccountAndState: async () => filters,
			refreshExpiry: async (f: FilterItem) => f,
		} as unknown as IFilterRepository,
		filterAnchorService: {
			get: async () => undefined,
		} as unknown as IFilterAnchorRepository,
		messageLabelService: {} as unknown as IMessageLabelRepository,
		placementMoveService: {} as unknown as PlacementMoveService,
		embedder: {
			embed: async () => {
				state.embedCalls += 1;
				return [];
			},
			embeddingId: "test-model@0",
		},
	};
	return { pipeline: new FilterPipeline(config, { info: () => {} }), state };
};

describe("FilterPipeline — anchorless From/Or filter at index time", () => {
	it("resolves the move for a matching sender and never embeds", async () => {
		const { pipeline, state } = buildPipeline(senderFilter("mbx-archive"));
		const decision = await pipeline.evaluate("cfg-1", "m-1", {
			from: "npm@github.com",
			fromName: "npm",
			subject: "A new version of left-pad is available",
			text: "body",
			listId: "",
		});

		assert.deepEqual(decision.move, {
			destinationMailboxId: "mbx-archive",
			filterId: "flt-senders",
		});
		// A literal-only filter is decided by its clauses alone — the embedder is
		// never constructed or called.
		assert.equal(state.embedCalls, 0);
	});

	it("resolves nothing for a sender none of the clauses match", async () => {
		const { pipeline, state } = buildPipeline(senderFilter("mbx-archive"));
		const decision = await pipeline.evaluate("cfg-1", "m-2", {
			from: "hello@stripe.com",
			fromName: "Stripe",
			subject: "Your receipt",
			text: "body",
			listId: "",
		});

		assert.equal(decision.move, undefined);
		assert.deepEqual(decision.labels, []);
		assert.equal(state.embedCalls, 0);
	});
});

/**
 * Arbitration survives exactly here: two standing filters colliding over the
 * same message at the same trigger. A move is exclusive, so the pass resolves
 * one destination — the more-recently-changed action wins (reader #497 leaves
 * this untouched while removing arbitration from the user-initiated apply).
 */
describe("FilterPipeline — two standing filters colliding on one message", () => {
	const rivalFilter = (): FilterItem =>
		({
			...senderFilter("mbx-projects"),
			filterId: "flt-rival",
			name: "github to projects",
			actionChangedAt: 2,
		}) as unknown as FilterItem;

	it("resolves a single destination from the more-recently-changed action", async () => {
		const older = {
			...senderFilter("mbx-archive"),
			actionChangedAt: 1,
		} as unknown as FilterItem;
		const { pipeline } = buildPipeline(older, rivalFilter());
		const decision = await pipeline.evaluate("cfg-1", "m-3", {
			from: "npm@github.com",
			fromName: "npm",
			subject: "A new version of left-pad is available",
			text: "body",
			listId: "",
		});

		assert.deepEqual(decision.move, {
			destinationMailboxId: "mbx-projects",
			filterId: "flt-rival",
		});
	});
});

describe("FilterPipeline — anchor lazy re-embed on model drift (reader #295)", () => {
	const anchoredFilter = (): FilterItem =>
		({
			filterId: "flt-semantic",
			accountConfigId: "cfg-1",
			name: "receipts",
			scope: "Standing",
			state: FilterState.Active,
			hasAnchor: true,
			ruleChangedAt: 1,
			matchOperator: FilterMatchOperator.And,
			literalClauses: [],
			actionLabelId: "lbl-1",
			actionMailboxId: NO_ACTION,
			createdAt: 1,
			updatedAt: 1,
		}) as unknown as FilterItem;

	const message = {
		from: "billing@stripe.com",
		fromName: "Stripe",
		subject: "Your receipt",
		text: "Thanks for your payment",
		listId: "",
	};

	it("re-embeds a stale anchor and matches on the very next evaluation, persisting the refreshed row", async () => {
		const putCalls: Array<Record<string, unknown>> = [];
		let embedCalls = 0;
		const config: FilterConfig = {
			filterService: {
				listByAccountAndState: async () => [anchoredFilter()],
				refreshExpiry: async (f: FilterItem) => f,
			} as unknown as IFilterRepository,
			filterAnchorService: {
				get: async () => ({
					accountConfigId: "cfg-1",
					filterId: "flt-semantic",
					// Stale-model space — orthogonal to what the current model
					// produces, so a raw comparison against it would not match.
					anchorEmbedding: [0, 1, 0],
					anchorEmbeddingId: "old-model@3",
					anchorSourceText: "your receipt is ready",
					anchorMessageId: "msg-anchor",
				}),
				put: async (input: Record<string, unknown>) => {
					putCalls.push(input);
					return { ...input, createdAt: 1, updatedAt: 2 };
				},
			} as unknown as IFilterAnchorRepository,
			messageLabelService: {} as unknown as IMessageLabelRepository,
			placementMoveService: {} as unknown as PlacementMoveService,
			embedder: {
				embed: async () => {
					embedCalls += 1;
					return [1, 0, 0];
				},
				embeddingId: "new-model@3",
			},
		};

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-1", message);

		assert.deepEqual(
			decision.labels,
			[{ labelId: "lbl-1", filterId: "flt-semantic" }],
			"the anchor matches once re-embedded into the current model's space",
		);
		assert.equal(
			putCalls.length,
			1,
			"the refreshed anchor is written back exactly once",
		);
		assert.deepEqual(putCalls[0], {
			accountConfigId: "cfg-1",
			filterId: "flt-semantic",
			anchorEmbedding: [1, 0, 0],
			anchorEmbeddingId: "new-model@3",
			anchorSourceText: "your receipt is ready",
			anchorMessageId: "msg-anchor",
		});
		assert.equal(
			embedCalls,
			2,
			"one embed re-embeds the anchor's source text, one embeds the candidate message",
		);
	});

	it("never re-embeds when the anchor's embeddingId is already current", async () => {
		let putCalls = 0;
		let embedCalls = 0;
		const config: FilterConfig = {
			filterService: {
				listByAccountAndState: async () => [anchoredFilter()],
				refreshExpiry: async (f: FilterItem) => f,
			} as unknown as IFilterRepository,
			filterAnchorService: {
				get: async () => ({
					anchorEmbedding: [1, 0, 0],
					anchorEmbeddingId: "current-model@3",
					anchorSourceText: "your receipt is ready",
					anchorMessageId: "msg-anchor",
				}),
				put: async () => {
					putCalls += 1;
					throw new Error("must not be called");
				},
			} as unknown as IFilterAnchorRepository,
			messageLabelService: {} as unknown as IMessageLabelRepository,
			placementMoveService: {} as unknown as PlacementMoveService,
			embedder: {
				embed: async () => {
					embedCalls += 1;
					return [1, 0, 0];
				},
				embeddingId: "current-model@3",
			},
		};

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-1", message);

		assert.deepEqual(decision.labels, [
			{ labelId: "lbl-1", filterId: "flt-semantic" },
		]);
		assert.equal(putCalls, 0, "a current anchor is never rewritten");
		assert.equal(
			embedCalls,
			1,
			"only the candidate message is embedded — no wasted re-embed call",
		);
	});

	it("degrades a re-embed failure to skipping just this filter, not the whole pass", async () => {
		const literalFilter: FilterItem = {
			filterId: "flt-literal",
			accountConfigId: "cfg-1",
			name: "stripe receipts",
			scope: "Standing",
			state: FilterState.Active,
			hasAnchor: false,
			ruleChangedAt: 1,
			matchOperator: FilterMatchOperator.Or,
			literalClauses: [{ field: FilterClauseField.From, value: "stripe.com" }],
			actionLabelId: "lbl-literal",
			actionMailboxId: NO_ACTION,
			createdAt: 1,
			updatedAt: 1,
		} as unknown as FilterItem;

		const config: FilterConfig = {
			filterService: {
				listByAccountAndState: async () => [anchoredFilter(), literalFilter],
				refreshExpiry: async (f: FilterItem) => f,
			} as unknown as IFilterRepository,
			filterAnchorService: {
				get: async () => ({
					anchorEmbedding: [0, 1, 0],
					anchorEmbeddingId: "old-model@3",
					anchorSourceText: "your receipt is ready",
					anchorMessageId: "msg-anchor",
				}),
				put: async () => {
					throw new Error("SQLITE_BUSY");
				},
			} as unknown as IFilterAnchorRepository,
			messageLabelService: {} as unknown as IMessageLabelRepository,
			placementMoveService: {} as unknown as PlacementMoveService,
			embedder: {
				embed: async () => [1, 0, 0],
				embeddingId: "new-model@3",
			},
		};

		const decision = await new FilterPipeline(config, {
			info: () => {},
			error: () => {},
		}).evaluate("cfg-1", "m-1", message);

		assert.deepEqual(
			decision.labels,
			[{ labelId: "lbl-literal", filterId: "flt-literal" }],
			"the anchored filter's re-embed failure is isolated — the literal filter still applies",
		);
	});
});
