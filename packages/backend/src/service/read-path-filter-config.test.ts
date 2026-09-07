import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FilterAnchorItem, FilterItem } from "@remit/data-ports";
import { FilterMatchOperator, FilterState } from "@remit/domain-enums";
import {
	buildMatchText,
	type FilterMessage,
	FilterPipeline,
	NO_ACTION,
} from "@remit/mailbox-service";
import { buildEmbeddingServiceFromEnv } from "@remit/search-service/from-env";
import {
	buildReadPathFilterConfig,
	type RemitClientRepositories,
} from "./create-remit-client.js";

const MESSAGE: FilterMessage = {
	from: "billing@stripe.com",
	fromName: "Stripe",
	subject: "Your receipt",
	text: "Thanks for your payment",
	listId: "",
};

const anchorOnlyFilter: FilterItem = {
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
	actionMailboxId: "mbx-receipts",
	createdAt: 1,
	updatedAt: 1,
} as unknown as FilterItem;

const repositoriesWithAnchor = (
	anchor: FilterAnchorItem,
): RemitClientRepositories =>
	({
		filter: {
			listByAccountAndState: async () => [anchorOnlyFilter],
			refreshExpiry: async (filter: FilterItem) => filter,
		},
		filterAnchor: { get: async () => anchor },
		messageLabel: {},
		message: {},
		threadMessage: {},
		placementMove: {},
		address: {},
		mailboxSpecialUse: {},
	}) as unknown as RemitClientRepositories;

// The read path must embed a candidate message under the same model that wrote
// the anchors, so an anchor written from this text matches it exactly.
const anchorFor = async (message: FilterMessage): Promise<FilterAnchorItem> => {
	const embedding = buildEmbeddingServiceFromEnv();
	const [anchorEmbedding] = await embedding.embed([buildMatchText(message)]);
	return {
		accountConfigId: "cfg-1",
		filterId: "flt-semantic",
		anchorEmbedding,
		anchorEmbeddingId: embedding.embeddingId,
		anchorSourceText: buildMatchText(message),
		anchorMessageId: "m-anchor",
	} as unknown as FilterAnchorItem;
};

describe("buildReadPathFilterConfig", () => {
	let previousQueueUrl: string | undefined;

	beforeEach(() => {
		previousQueueUrl = process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
		process.env.SQS_QUEUE_URL_MESSAGE_MGMT =
			"https://sqs.eu-west-1.amazonaws.com/0/test-message-mgmt";
	});

	afterEach(() => {
		if (previousQueueUrl === undefined) {
			delete process.env.SQS_QUEUE_URL_MESSAGE_MGMT;
			return;
		}
		process.env.SQS_QUEUE_URL_MESSAGE_MGMT = previousQueueUrl;
	});

	it("moves a message an anchor-only filter matches, with no embedder passed in", async () => {
		const config = buildReadPathFilterConfig(
			repositoriesWithAnchor(await anchorFor(MESSAGE)),
		);
		assert.ok(config);

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-1", MESSAGE);

		assert.deepEqual(decision.move, {
			destinationMailboxId: "mbx-receipts",
			filterId: "flt-semantic",
		});
	});

	it("leaves a message the anchor does not match where it is", async () => {
		const config = buildReadPathFilterConfig(
			repositoriesWithAnchor(
				await anchorFor({
					...MESSAGE,
					from: "noreply@example.test",
					fromName: "Example",
					subject: "Scheduled maintenance window",
					text: "Our service will be unavailable on Sunday",
				}),
			),
		);
		assert.ok(config);

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-2", MESSAGE);

		assert.equal(decision.move, undefined);
	});

	it("keeps filters off when the message-management queue is unset", () => {
		delete process.env.SQS_QUEUE_URL_MESSAGE_MGMT;

		assert.equal(
			buildReadPathFilterConfig(
				repositoriesWithAnchor({} as unknown as FilterAnchorItem),
			),
			undefined,
		);
	});
});
