import { createLogger, startMetricsServer } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { handler } from "./index.js";

/** Production queue poller — the deployed form of `e2e-processor-shim.ts`. */
const log = createLogger();

// /metrics and nothing else, on the compose network (standalone-observability
// D2). No health route on it: worker liveness is a heartbeat file, which keeps
// answering when this server does not.
startMetricsServer();

await runQueuePoller({
	log,
	targets: [
		{
			queueUrl: env.SQS_QUEUE_URL_SMTP,
			handler,
			functionName: "smtp-worker",
		},
	],
});
