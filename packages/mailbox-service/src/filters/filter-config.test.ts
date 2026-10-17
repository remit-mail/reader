import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FilterMatchOperator, FilterScope } from "@remit/domain-enums";
import { _resetEmbeddingCapabilityForTest } from "@remit/search-service/capability";
import { PlacementMoveService } from "../placement-move.js";
import { openStore, type Store } from "../test-helpers/test-store.js";
import { buildFilterConfig, type FilterConfigDeps } from "./filter-config.js";
import type { FilterMessage } from "./match.js";
import { _resetMessageEmbedderForTest } from "./message-embedder.js";
import { FilterPipeline, type MessageEmbedder } from "./pipeline.js";

const CURRENT_MODEL = "test-model@3";

let store: Store;
let filterId: string;

beforeEach(async () => {
	store = await openStore();
	const filter = await store.filter.create({
		accountConfigId: "cfg-1",
		name: "receipts",
		scope: FilterScope.Standing,
		hasAnchor: true,
		matchOperator: FilterMatchOperator.Or,
		actionMailboxId: "mbx-archive",
	});
	filterId = filter.filterId;
	await store.filterAnchor.put({
		accountConfigId: "cfg-1",
		filterId,
		anchorEmbedding: [1, 0, 0],
		anchorEmbeddingId: CURRENT_MODEL,
		anchorSourceText: "your receipt is ready",
		anchorMessageId: "msg-anchor",
	});
});

afterEach(() => store.close());

const repos = (): FilterConfigDeps => ({
	filterService: store.filter,
	filterAnchorService: store.filterAnchor,
	messageLabelService: store.messageLabel,
	placementMoveService: new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		sqsQueueUrl: "https://sqs.test/message-mgmt",
	}),
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
		const deps = repos();
		deps.placementMoveService = undefined;

		assert.equal(buildFilterConfig(deps), undefined);
	});

	it("wires an embedder into the config", () => {
		const config = buildFilterConfig(repos());

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
		const config = buildFilterConfig(repos(), embedder);
		assert.ok(config);

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-1", message);

		assert.deepEqual(decision.move, {
			destinationMailboxId: "mbx-archive",
			filterId,
		});
		assert.equal(embedCalls, 1);
	});

	it("does not match when the message embedding diverges from the anchor", async () => {
		const embedder: MessageEmbedder = {
			embed: async () => [0, 1, 0],
			embeddingId: CURRENT_MODEL,
		};
		const config = buildFilterConfig(repos(), embedder);
		assert.ok(config);

		const decision = await new FilterPipeline(config, {
			info: () => {},
		}).evaluate("cfg-1", "m-2", message);

		assert.equal(decision.move, undefined);
	});
});

// An instance with semantic search off (issue #1068). `off` selects an embedder
// that throws by design, and the throw lands in the pipeline's per-filter catch:
// one error-level `filter_anchor_match_failed` for every semantic filter on
// every message it syncs. The pipeline already has a designed skip for a
// missing embedder, so the config passes none.
describe("buildFilterConfig with semantic search off", () => {
	const withProviderOff = async (body: () => Promise<void>): Promise<void> => {
		const previous = process.env.SEARCH_EMBEDDING_PROVIDER;
		process.env.SEARCH_EMBEDDING_PROVIDER = "off";
		_resetMessageEmbedderForTest();
		try {
			await body();
		} finally {
			if (previous === undefined) {
				delete process.env.SEARCH_EMBEDDING_PROVIDER;
			} else {
				process.env.SEARCH_EMBEDDING_PROVIDER = previous;
			}
			_resetMessageEmbedderForTest();
		}
	};

	it("wires no embedder", async () => {
		await withProviderOff(async () => {
			const config = buildFilterConfig(repos());

			assert.ok(config);
			assert.equal(config.embedder, undefined);
		});
	});

	it("skips the semantic filter without logging an error", async () => {
		await withProviderOff(async () => {
			const config = buildFilterConfig(repos());
			assert.ok(config);

			const errors: unknown[] = [];
			const decision = await new FilterPipeline(config, {
				info: () => {},
				debug: () => {},
				warn: () => {},
				error: (fields) => errors.push(fields.alert),
			}).evaluate("cfg-1", "m-off", message);

			assert.deepEqual(decision.labels, []);
			assert.equal(decision.move, undefined);
			assert.deepEqual(errors, []);
		});
	});
});

// The self-host `local` profile asks for the Transformers.js embedder, but the
// backend and imap-worker images ship without `@huggingface/transformers`
// (npm-scripts/docker-bundle.mjs). The first embed throws ERR_MODULE_NOT_FOUND,
// which is the same capability absence `off` states and must take the same
// designed skip — not an error-level `filter_anchor_match_failed` per semantic
// filter per message on a user-facing GET.
describe("buildFilterConfig when this deployment carries no embedder", () => {
	const moduleNotFound = (): Error =>
		Object.assign(
			new Error("Cannot find package '@huggingface/transformers'"),
			{ code: "ERR_MODULE_NOT_FOUND" },
		);

	it("skips the semantic filter, logs no error, and stops wiring an embedder", async () => {
		const previous = process.env.SEARCH_EMBEDDING_PROVIDER;
		process.env.SEARCH_EMBEDDING_PROVIDER = "local";
		_resetMessageEmbedderForTest();
		_resetEmbeddingCapabilityForTest();

		try {
			const unavailable: MessageEmbedder = {
				embed: async () => {
					throw moduleNotFound();
				},
				embeddingId: CURRENT_MODEL,
			};
			const config = buildFilterConfig(repos(), unavailable);
			assert.ok(config);

			const errors: unknown[] = [];
			const decision = await new FilterPipeline(config, {
				info: () => {},
				debug: () => {},
				warn: () => {},
				error: (fields) => errors.push(fields.alert),
			}).evaluate("cfg-1", "m-local", message);

			assert.deepEqual(decision.labels, []);
			assert.equal(decision.move, undefined);
			assert.deepEqual(errors, []);

			// Probed once, not per filter or per message: every later config on this
			// process wires no embedder at all, so nothing else attempts the embed.
			const next = buildFilterConfig(repos());
			assert.ok(next);
			assert.equal(next.embedder, undefined);
		} finally {
			if (previous === undefined) {
				delete process.env.SEARCH_EMBEDDING_PROVIDER;
			} else {
				process.env.SEARCH_EMBEDDING_PROVIDER = previous;
			}
			_resetMessageEmbedderForTest();
			_resetEmbeddingCapabilityForTest();
		}
	});
});
