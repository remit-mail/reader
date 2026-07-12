import { createLogger } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { handler } from "./index.js";

/** Production queue poller — the deployed form of `e2e-processor-shim.ts`. */
const log = createLogger();

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
