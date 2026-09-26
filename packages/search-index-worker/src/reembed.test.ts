import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IndexedChunkProvenance } from "@remit/search-service";
import {
	formatReembed,
	parseReembedScope,
	type ReembedQueue,
	reembedIndex,
	reembedRefusal,
} from "./reembed.js";

const CURRENT = "local:multilingual-MiniLM:q8@384";
const OLDER = "local:MiniLM@384";

const INDEX: IndexedChunkProvenance[] = [
	{ messageId: "m-current", embeddingId: CURRENT },
	{ messageId: "m-current", embeddingId: CURRENT },
	{ messageId: "m-older", embeddingId: OLDER },
	{ messageId: "m-older", embeddingId: OLDER },
	{ messageId: "m-mixed", embeddingId: CURRENT },
	{ messageId: "m-mixed", embeddingId: OLDER },
	{ messageId: "m-unknown", embeddingId: undefined },
];

const recordingQueue = (): ReembedQueue & { requested: string[] } => {
	const requested: string[] = [];
	return {
		requested,
		requestReembed: async (messageIds) => {
			requested.push(...messageIds);
			return { queued: messageIds.length, alreadyQueued: 0 };
		},
	};
};

const run = async (args: string[], index = INDEX) => {
	const queue = recordingQueue();
	const result = await reembedIndex({
		configuredEmbeddingId: CURRENT,
		scope: parseReembedScope(args),
		readChunks: async (consume) => consume(index),
		queue,
	});
	return { result, requested: queue.requested };
};

describe("reembedIndex", () => {
	it("re-queues every message with a vector from another model and skips current ones", async () => {
		const { result, requested } = await run([]);
		assert.deepEqual(requested, ["m-mixed", "m-older", "m-unknown"]);
		assert.equal(result.queued, 3);
	});

	it("re-queues only the messages carrying the named model", async () => {
		const { requested } = await run(["--model", OLDER]);
		assert.deepEqual(requested, ["m-mixed", "m-older"]);
	});

	it("re-queues messages already on the current model with --all", async () => {
		const { requested } = await run(["--all"]);
		assert.deepEqual(requested, [
			"m-current",
			"m-mixed",
			"m-older",
			"m-unknown",
		]);
	});

	it("queues nothing when every message is on the current model", async () => {
		const { result, requested } = await run(
			[],
			[{ messageId: "m-current", embeddingId: CURRENT }],
		);
		assert.deepEqual(requested, []);
		assert.match(formatReembed(result), /already on .*Pass --all/);
	});
});

describe("parseReembedScope", () => {
	it("refuses --all together with --model", () => {
		assert.throws(() => parseReembedScope(["--all", "--model", OLDER]));
	});

	it("refuses an option it does not know", () => {
		assert.throws(() => parseReembedScope(["--repair"]));
	});
});

describe("formatReembed", () => {
	it("reports queued messages and the ones that no longer exist", () => {
		const text = formatReembed({
			configuredEmbeddingId: CURRENT,
			scope: { kind: "stale" },
			selected: 4,
			queued: 2,
			alreadyQueued: 1,
		});
		assert.match(
			text,
			new RegExp(`Queued 2 messages to re-embed with ${CURRENT}`),
		);
		assert.match(text, /Skipped 1 indexed message no longer in the mailbox/);
		assert.match(text, /Skipped 1 message already waiting for a re-embed/);
	});

	it("names the model when nothing carries it", () => {
		const text = formatReembed({
			configuredEmbeddingId: CURRENT,
			scope: { kind: "model", embeddingId: OLDER },
			selected: 0,
			queued: 0,
			alreadyQueued: 0,
		});
		assert.match(
			text,
			new RegExp(`No indexed message carries vectors from ${OLDER}`),
		);
	});
});

describe("reembedRefusal", () => {
	for (const provider of ["off", "deterministic"] as const) {
		it(`refuses while the provider is ${provider}`, () => {
			assert.match(reembedRefusal(provider) ?? "", /no model to re-embed with/);
		});
	}

	for (const provider of ["local", "bedrock"] as const) {
		it(`runs with the ${provider} provider`, () => {
			assert.equal(reembedRefusal(provider), undefined);
		});
	}
});
