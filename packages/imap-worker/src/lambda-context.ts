import { getClient } from "@remit/backend/client";
import type { IMailboxLockRepository } from "@remit/data-ports";
import type { Logger } from "@remit/logger";
import { recordImapFailure } from "@remit/logger-lambda/metrics";
import {
	createMailOAuthService,
	microsoftProviderConfig,
} from "@remit/mail-oauth-service";
import { env } from "expect-env";
import { imapWorkerConfigFromEnv, poolOptionsFromEnv } from "./config-env.js";
import { createConnectionPool } from "./connection-pool.js";
import { createConnectionScopeWithCredentials } from "./connection-scope.js";
import type { ProcessContext, WorkerMetrics } from "./context.js";
import { createEmitEvent, type EmitEvent } from "./emit.js";
import type { WorkerQueues } from "./queues.js";
import { s3AccountObjects } from "./s3-account-objects.js";
import { sqsWorkerQueues, workerQueueUrlsFromEnv } from "./sqs-queues.js";

export const lambdaMetrics: WorkerMetrics = { imapFailure: recordImapFailure };

export const lambdaEmitEvent = (
	queues: WorkerQueues,
	mailboxLock: IMailboxLockRepository,
): EmitEvent =>
	createEmitEvent({ queues, mailboxLock, metrics: lambdaMetrics });

const buildContext = async (log: Logger): Promise<ProcessContext> => ({
	client: await getClient(),
	queues: sqsWorkerQueues(workerQueueUrlsFromEnv()),
	pool: createConnectionPool(
		poolOptionsFromEnv(process.env),
		createConnectionScopeWithCredentials,
	),
	metrics: lambdaMetrics,
	config: imapWorkerConfigFromEnv(process.env),
	log,
	oauth: createMailOAuthService(
		microsoftProviderConfig({
			clientId: process.env.MSOAUTH_CLIENT_ID ?? "",
			clientSecret: process.env.MSOAUTH_CLIENT_SECRET ?? "",
			overrides: process.env.MSOAUTH_TOKEN_ENDPOINT
				? { tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT }
				: undefined,
		}),
	),
	accountObjects: s3AccountObjects(() => env.S3_BUCKET_NAME),
});

let context: Promise<ProcessContext> | undefined;

export const lambdaProcessContext = (log: Logger): Promise<ProcessContext> => {
	context ??= buildContext(log);
	return context;
};
