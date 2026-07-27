import { onScrape, registry } from "@remit/logger-lambda/metrics";
import { Gauge } from "prom-client";

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
