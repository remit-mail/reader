import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	FilterItem,
	IFilterAnchorRepository,
	IFilterRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import { FilterMatchOperator, FilterState } from "@remit/domain-enums";
import {
	type FilterMessage,
	FilterPipeline,
	type MessageEmbedder,
	NO_ACTION,
	type PlacementMoveService,
} from "@remit/mailbox-service";
import { buildFilterConfig, type FilterConfigDeps } from "./filter-config.js";

const anchorOnlyFilter = (destinationMailboxId: string): FilterItem =>
	({
		filterId: "flt-semantic",
		accountConfigId: "cfg-1",
		name: "receipts",
		scope: "Standing",
		state: FilterState.Active,
		hasAnchor: true,
		ruleChangedAt: 1,
		matchOperator: FilterMatchOperator.Or,
		literalClauses: [],
		actionLabelId: NO_ACTION,
		actionMailboxId: destinationMailboxId,
		createdAt: 1,
		updatedAt: 1,
	}) as unknown as FilterItem;

const CURRENT_MODEL = "test-model@3";

const repos = (filter: FilterItem): FilterConfigDeps => ({
	filterService: {
		listByAccountAndState: async () => [filter],
		refreshExpiry: async (f: FilterItem) => f,
	} as unknown as IFilterRepository,
	filterAnchorService: {
		get: async () => ({
			anchorEmbedding: [1, 0, 0],
			anchorEmbeddingId: CURRENT_MODEL,
		}),
	} as unknown as IFilterAnchorRepository,
	messageLabelService: {} as unknown as IMessageLabelRepository,
	placementMoveService: {} as unknown as PlacementMoveService,
});

const message: FilterMessage = {
	from: "billing@stripe.com",
	fromName: "Stripe",
	subject: "Your receipt",
	text: "Thanks for your payment",
	listId: "",
};

describe("buildFilterConfig", () => {
	it("returns undefined without a placement mover — no move path, filters stay off", () => {
		const deps = repos(anchorOnlyFilter("mbx-archive"));
		deps.placementMoveService = undefined;

		assert.equal(buildFilterConfig(deps), undefined);
	});

	it("wires an embedder into the config", () => {
		const config = buildFilterConfig(repos(anchorOnlyFilter("mbx-archive")));

		assert.ok(config);
		assert.ok(config.embedder);
	});

	it("lights up a semantic anchor-only filter on the body-sync pass", async () => {
		let embedCalls = 0;
		const embedder: MessageEmbedder = {
			embed: async () => {
				embedCalls += 1;
				return [1, 0, 0];
			},
			embeddingId: CURRENT_MODEL,
		};
		const config = buildFilterConfig(
			repos(anchorOnlyFilter("mbx-archive")),
			embedder,
		);
		assert.ok(config);

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-1", message);

		assert.deepEqual(decision.move, {
			destinationMailboxId: "mbx-archive",
			filterId: "flt-semantic",
		});
		assert.equal(embedCalls, 1);
	});

	it("does not match when the message embedding diverges from the anchor", async () => {
		const embedder: MessageEmbedder = {
			embed: async () => [0, 1, 0],
			embeddingId: CURRENT_MODEL,
		};
		const config = buildFilterConfig(
			repos(anchorOnlyFilter("mbx-archive")),
			embedder,
		);
		assert.ok(config);

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-2", message);

		assert.equal(decision.move, undefined);
	});
});
