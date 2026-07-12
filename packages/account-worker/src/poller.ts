import { createLogger } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { fanoutHandler, finalizeHandler } from "./index.js";

/**
 * Production queue poller. No e2e shim exists for account-worker today —
 * the deletion cascade is not exercised on the Postgres/compose stack in
 * CI (see AGENTS.md worker roster notes). This is the standalone
 * production entrypoint for the dedicated image.
 *
 * The fanout worker's Cognito sign-out and the finalize worker's CloudFront
 * invalidation are AWS-only calls with no portable counterpart yet — on a
 * non-AWS deployment those specific steps of the deletion cascade will
 * error if account deletion is exercised. That is a pre-existing gap in
 * the application code, not something this packaging change fixes.
 */
const log = createLogger();

await runQueuePoller({
	log,
	targets: [
		{
			queueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
			handler: fanoutHandler,
			functionName: "account-fanout-worker",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_ACCOUNT_FINALIZE,
			handler: finalizeHandler,
			functionName: "account-finalize-worker",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_ACCOUNT_PURGE_DELETE,
			handler: finalizeHandler,
			functionName: "account-purge-worker",
		},
	],
});
