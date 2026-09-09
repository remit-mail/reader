import { onScrape, registry } from "@remit/logger-lambda/metrics";
import { Counter, Gauge } from "prom-client";
import type { EmbeddingPlan } from "./adaptive-embedder.js";

/**
 * Put the search index backlog (standalone-observability D3) on this process's
 * registry, read from `count` when a scrape arrives.
 *
 * The gauge is constructed here rather than at module scope, and this module is
 * not the shared one, for the same reason: it carries no labels, so prom-client
 * renders it from the moment it exists. Declared in the shared registry module
 * it would be a confident `0` in the backend, the queue sidecar and three
 * workers that cannot know the answer — five series separated only by
 * `instance`, four of them permanently wrong. Declared at this module's scope it
 * would be a `0` on every backend that has no outbox to count. The series exists
 * only where something computes it.
 */
const NAME = "remit_search_index_backlog_rows";

export const registerSearchIndexBacklog = (
	count: () => Promise<number>,
): void => {
	// Registering twice replaces the reader rather than throwing on the duplicate
	// name — the caller is saying where the count comes from now.
	registry.removeSingleMetric(NAME);
	const backlogRows = new Gauge({
		name: NAME,
		help: "Search-index outbox rows that have not been relayed yet.",
		registers: [registry],
	});
	onScrape(async () => backlogRows.set(await count()));
};

const BATCH_SIZE = "remit_search_index_embed_batch_size";
const CONCURRENCY = "remit_search_index_embed_concurrency";
const STALLS = "remit_search_index_memory_stalls_total";

export interface AdaptiveEmbeddingMetrics {
	recordPlan(plan: EmbeddingPlan): void;
	recordStall(): void;
}

/**
 * What the governor (#585) decided, for the same reason as the backlog above:
 * the three series exist only in the process that computes them. Together they
 * answer the question a slow first index raises — whether the worker is being
 * held back by the box, and how often it had to stop outright.
 */
export const registerAdaptiveEmbedding = (
	initial: EmbeddingPlan,
): AdaptiveEmbeddingMetrics => {
	for (const name of [BATCH_SIZE, CONCURRENCY, STALLS]) {
		registry.removeSingleMetric(name);
	}
	const batchSize = new Gauge({
		name: BATCH_SIZE,
		help: "Chunk texts the search-index worker sends to the embedder per call.",
		registers: [registry],
	});
	const concurrency = new Gauge({
		name: CONCURRENCY,
		help: "Embedding calls the search-index worker keeps in flight at once.",
		registers: [registry],
	});
	const stalls = new Counter({
		name: STALLS,
		help: "Times indexing stopped and waited for the box to free memory.",
		registers: [registry],
	});
	const recordPlan = (plan: EmbeddingPlan): void => {
		batchSize.set(plan.batchSize);
		concurrency.set(plan.concurrency);
	};
	recordPlan(initial);
	return { recordPlan, recordStall: () => stalls.inc() };
};
