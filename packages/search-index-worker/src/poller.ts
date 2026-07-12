import { createLogger } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { handler } from "./index.js";

/** Production queue poller — no e2e shim exists for this queue today (the
 * e2e/CI stack piggybacks it onto the imap-worker shim); this is the
 * standalone production entrypoint for the dedicated image. */
const log = createLogger();

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
