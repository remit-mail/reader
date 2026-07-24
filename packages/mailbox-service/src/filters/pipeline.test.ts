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

const buildPipeline = (filter: FilterItem) => {
	const state = { embedCalls: 0 };
	const config: FilterConfig = {
		filterService: {
			listByAccountAndState: async () => [filter],
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
