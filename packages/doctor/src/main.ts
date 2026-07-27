import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";
import { pingDeadMan } from "./deadman.js";
import { describeError, log, setLogLevel } from "./log.js";
import { runLoop, sleep } from "./loop.js";
import { readState, writeState } from "./state.js";
import { postWebhook } from "./webhook.js";

/**
 * The `doctor` service (D9). A socket-free node process on the compose network:
 * it scrapes the `/metrics` endpoints over that network and mounts the
 * heartbeat volume read-only, and nothing else.
 *
 * It is its own container rather than a job inside the backend because an
 * alerter inside the backend dies with the thing it is meant to report. It runs
 * whether or not alerting is configured, because `remit doctor` execs into it.
 */
const config = await Promise.resolve()
	.then(() => loadConfig())
	.catch((error: unknown) => {
		log.error({ error: describeError(error) }, "doctor: refusing to start");
		return process.exit(1);
	});

setLogLevel(config.logLevel);

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		log.info({ signal }, "doctor: shutting down");
		controller.abort();
	});
}

log.info(
	{
		intervalSeconds: config.intervalMs / 1000,
		dwellChecks: config.dwellChecks,
		targets: config.targets.map((target) => target.service),
		alerting: config.webhookUrl !== undefined,
	},
	"doctor: started",
);

await runLoop({
	config,
	initial: await readState(config.stateDir),
	signal: controller.signal,
	sleep,
	deps: {
		runCheck: (counters) => runCheck(config, counters),
		saveState: (state) => writeState(config.stateDir, state),
		postWebhook: (result) =>
			postWebhook(
				{
					// Reached only when a transition fired, which requires the URL.
					url: config.webhookUrl ?? "",
					template: config.webhookTemplate,
					contentType: config.webhookContentType,
					timeoutMs: config.requestTimeoutMs,
				},
				result,
			),
		pingDeadMan: () =>
			pingDeadMan(config.deadManUrl ?? "", config.requestTimeoutMs),
		now: () => new Date(),
		log,
	},
});
