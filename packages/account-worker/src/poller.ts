import { createLogger, startMetricsServer } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { fanoutHandler, finalizeHandler } from "./index.js";

/**
 * Production queue poller. No e2e shim exists for account-worker today —
 * the deletion cascade is not exercised on the compose stack in
 * CI (see AGENTS.md worker roster notes). This is the standalone
 * production entrypoint for the dedicated image.
 *
 * The deployment-specific steps of the cascade — sign-out, content
 * invalidation, storage cleanup, and the row cascade — resolve through the
 * deletion capabilities seam (deletion-capabilities.ts): AWS runs Cognito
 * global sign-out and CloudFront invalidation; the relational self-host
 * backends run the no-op counterparts and a filesystem/Drizzle cascade. The
 * imap-worker stop signal is a no-op acknowledgement whose queue is optional,
 * skipped where it is not provisioned. Account deletion completes on every
 * deployment flavor.
 */
const log = createLogger();

// /metrics and nothing else, on the compose network (standalone-observability
// D2). No health route on it: worker liveness is a heartbeat file, which keeps
// answering when this server does not.
startMetricsServer();

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
