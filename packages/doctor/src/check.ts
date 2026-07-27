import type { DoctorConfig } from "./config.js";
import { readHeartbeats } from "./heartbeats.js";
import { type Fetcher, scrapeAll } from "./scrape.js";
import { type CheckResult, evaluate } from "./verdict.js";

/**
 * One check: scrape the endpoints that carry a signal, read the heartbeat
 * volume, and evaluate. The same function the loop runs on its interval and the
 * exec seam runs on demand — the verdict is computed in one place and read
 * three ways, at a shell, as an exit code, and as an alert.
 */
export const runCheck = async (
	config: DoctorConfig,
	previousCounters: Readonly<Record<string, number>>,
	now: Date = new Date(),
	fetcher: Fetcher = fetch,
): Promise<CheckResult> => {
	const [scrapes, heartbeats] = await Promise.all([
		scrapeAll(config.targets, config.scrapeTimeoutMs, fetcher),
		readHeartbeats(
			config.heartbeatDir,
			config.heartbeatServices,
			now.getTime(),
		),
	]);
	return evaluate({
		scrapes,
		heartbeats,
		previousCounters,
		heartbeatMaxAgeSeconds: config.heartbeatMaxAgeSeconds,
		syncAgeMaxSeconds: config.syncAgeMaxSeconds,
		now,
	});
};
