import { type DoctorConfig, TUNNEL_TLS_MODE } from "./config.js";
import { readHeartbeats } from "./heartbeats.js";
import { type Fetcher, scrapeAll } from "./scrape.js";
import type { CounterState } from "./state.js";
import { probeTunnel, type TunnelReading } from "./tunnel.js";
import { type CheckResult, evaluate } from "./verdict.js";

/**
 * The tunnel is only a signal on a deployment that serves through one. A probe
 * on any other mode would report a service that is not in the stack, which is
 * the check being degraded by its own configuration.
 */
const readTunnel = (
	config: DoctorConfig,
	fetcher: Fetcher,
): Promise<TunnelReading | undefined> =>
	config.tlsMode === TUNNEL_TLS_MODE
		? probeTunnel(config.tunnelReadyUrl, config.scrapeTimeoutMs, fetcher)
		: Promise.resolve(undefined);

/**
 * One check: scrape the endpoints that carry a signal, read the heartbeat
 * volume, and evaluate. The same function the loop runs on its interval and the
 * exec seam runs on demand — the verdict is computed in one place and read
 * three ways, at a shell, as an exit code, and as an alert.
 */
export const runCheck = async (
	config: DoctorConfig,
	previousCounters: Readonly<Record<string, CounterState>>,
	now: Date = new Date(),
	fetcher: Fetcher = fetch,
): Promise<CheckResult> => {
	const [scrapes, heartbeats, tunnel] = await Promise.all([
		scrapeAll(config.targets, config.scrapeTimeoutMs, fetcher),
		readHeartbeats(
			config.heartbeatDir,
			config.heartbeatServices,
			now.getTime(),
		),
		readTunnel(config, fetcher),
	]);
	return evaluate({
		scrapes,
		heartbeats,
		tunnel,
		previousCounters,
		heartbeatMaxAgeSeconds: config.heartbeatMaxAgeSeconds,
		syncAgeMaxSeconds: config.syncAgeMaxSeconds,
		authFailureHoldSeconds: config.authFailureHoldSeconds,
		now,
	});
};
