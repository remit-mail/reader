import { createLogger, startMetricsServer } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { handler } from "./index.js";
import { registerSearchIndexBacklog } from "./metrics.js";
import { getMemoryGovernor } from "./services.js";
import { maybeStartSqliteOutboxDrain } from "./sqlite-outbox-drain.js";

/** Production queue poller — no e2e shim exists for this queue today (the
 * e2e/CI stack piggybacks it onto the imap-worker shim); this is the
 * standalone production entrypoint for the dedicated image. */
const log = createLogger();

// On the SQLite backend (RFC 036 D2) this container also owns the outbox wake:
// a 2-second poll relaying committed rows onto the search-index queue this same
// process consumes. A no-op on every other backend. Started before the poll
// loop, which blocks until shutdown, then stopped after it returns.
const drain = await maybeStartSqliteOutboxDrain(log);

// The backlog is a count of rows in the shared file, so it is read when a
// scrape arrives rather than tracked as work moves. Registered only where there
// is an outbox to count, so on every other backend the series is absent rather
// than a zero nothing computed.
if (drain) {
	registerSearchIndexBacklog(() => drain.countBacklog());
}

// The memory governor (#585) is built here, before the first message: a
// threshold the operator typed wrong must fail the container rather than one
// email, and its gauges must be on the registry before the first scrape.
getMemoryGovernor();

// /metrics and nothing else, on the compose network (D2). Started before the
// poll loop, which blocks until shutdown.
startMetricsServer();

try {
	await runQueuePoller({
		log,
		targets: [
			{
				queueUrl: env.SQS_QUEUE_URL_SEARCH_INDEX,
				handler,
				functionName: "search-index-worker",
			},
		],
	});
} finally {
	await drain?.stop();
}
