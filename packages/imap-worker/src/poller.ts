import { createLogger } from "@remit/logger-lambda";
import { runQueuePoller } from "@remit/sqs-client/poller";
import { env } from "expect-env";
import { handler } from "./index.js";

/**
 * Production queue poller — the deployed form of `e2e-processor-shim.ts`.
 * Polls every imap-worker queue and invokes the production Lambda handler.
 * The search-index queue is NOT polled here: it is its own image/deployment
 * (`remit-search-index-worker`), unlike the e2e shim which piggybacks it
 * onto this same process for test convenience.
 */
const log = createLogger();

await runQueuePoller({
	log,
	targets: [
		{
			queueUrl: env.SQS_QUEUE_URL_MAILBOXES,
			handler,
			functionName: "imap-worker-mailboxes",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_MESSAGES,
			handler,
			functionName: "imap-worker-messages",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_FLAGS,
			handler,
			functionName: "imap-worker-flags",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_BODY,
			handler,
			functionName: "imap-worker-body",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_MAILBOX_MGMT,
			handler,
			functionName: "imap-worker-mailbox-mgmt",
		},
		{
			queueUrl: env.SQS_QUEUE_URL_MESSAGE_MGMT,
			handler,
			functionName: "imap-worker-message-mgmt",
		},
	],
});
