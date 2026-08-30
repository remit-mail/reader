import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { renderMetrics, resetMetrics } from "@remit/logger-lambda/metrics";
import {
	registerAdaptiveEmbedding,
	registerSearchIndexBacklog,
} from "./metrics.js";

const backlogLines = (text: string): string[] =>
	text
		.split("\n")
		.filter(
			(line) =>
				line.startsWith("remit_search_index_backlog") && line.length > 0,
		);

describe("the search index backlog series", () => {
	beforeEach(() => resetMetrics());

	// The reason this gauge is declared inside a function, in this package, and
	// not at module scope in the shared registry: it carries no labels, so it
	// renders from the moment it exists. Declared where every service can import
	// it, four processes that cannot count an outbox would each publish a
	// confident 0.
	it("renders nothing in a process that never registered it", async () => {
		assert.deepEqual(backlogLines(await renderMetrics()), []);
	});

	it("reports the count the registered reader returns", async () => {
		registerSearchIndexBacklog(async () => 7);
		const text = await renderMetrics();
		assert.match(text, /^# TYPE remit_search_index_backlog_rows gauge$/m);
		assert.match(text, /^remit_search_index_backlog_rows 7$/m);
	});

	it("re-reads on every scrape", async () => {
		let rows = 3;
		registerSearchIndexBacklog(async () => rows);
		assert.match(await renderMetrics(), /^remit_search_index_backlog_rows 3$/m);
		rows = 0;
		assert.match(await renderMetrics(), /^remit_search_index_backlog_rows 0$/m);
	});

	it("fails the scrape when the outbox cannot be counted", async () => {
		registerSearchIndexBacklog(async () => {
			throw new Error("database is locked");
		});
		await assert.rejects(renderMetrics(), /database is locked/);
	});
});

describe("the adaptive embedding series", () => {
	beforeEach(() => resetMetrics());

	it("reports the plan it starts at, and each change after it", async () => {
		const metrics = registerAdaptiveEmbedding({
			batchSize: 4,
			concurrency: 1,
		});
		const start = await renderMetrics();
		assert.match(start, /^remit_search_index_embed_batch_size 4$/m);
		assert.match(start, /^remit_search_index_embed_concurrency 1$/m);

		metrics.recordPlan({ batchSize: 16, concurrency: 2 });
		const ramped = await renderMetrics();
		assert.match(ramped, /^remit_search_index_embed_batch_size 16$/m);
		assert.match(ramped, /^remit_search_index_embed_concurrency 2$/m);
	});

	it("counts every stop, which is what a slow first index is diagnosed from", async () => {
		const metrics = registerAdaptiveEmbedding({
			batchSize: 4,
			concurrency: 1,
		});
		metrics.recordStall();
		metrics.recordStall();
		assert.match(
			await renderMetrics(),
			/^remit_search_index_memory_stalls_total 2$/m,
		);
	});
});
