import { attempt } from "./attempt.js";
import type { ScrapeTarget } from "./config.js";
import { parseMetrics, type Sample } from "./prometheus.js";

/**
 * One target's scrape. A failure is a value, not a throw: an unreachable
 * endpoint is a signal the verdict has to carry, and a checker that aborts on
 * the first refused connection reports nothing about the services that did
 * answer.
 */
export interface ScrapeResult {
	readonly service: string;
	readonly samples: readonly Sample[];
	readonly error: string | undefined;
}

export type Fetcher = typeof fetch;

export const scrapeTarget = async (
	target: ScrapeTarget,
	timeoutMs: number,
	fetcher: Fetcher = fetch,
): Promise<ScrapeResult> => {
	const response = await attempt(
		fetcher(target.url, {
			signal: AbortSignal.timeout(timeoutMs),
			headers: { accept: "text/plain" },
		}),
	);
	if (!response.ok) {
		return { service: target.service, samples: [], error: response.error };
	}
	if (!response.value.ok) {
		return {
			service: target.service,
			samples: [],
			error: `HTTP ${response.value.status}`,
		};
	}
	const body = await attempt(response.value.text());
	if (!body.ok) {
		return { service: target.service, samples: [], error: body.error };
	}
	return {
		service: target.service,
		samples: parseMetrics(body.value),
		error: undefined,
	};
};

/**
 * Every target at once. They are independent endpoints on the same network and
 * the slowest is bounded by the scrape timeout, so a sequential pass would only
 * make the whole check as slow as the sum of its stalls.
 */
export const scrapeAll = async (
	targets: readonly ScrapeTarget[],
	timeoutMs: number,
	fetcher: Fetcher = fetch,
): Promise<ScrapeResult[]> =>
	Promise.all(
		targets.map((target) => scrapeTarget(target, timeoutMs, fetcher)),
	);
