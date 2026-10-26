import { getClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger";
import { recordImapFailure } from "@remit/logger-lambda/metrics";
import {
	createMailOAuthService,
	microsoftProviderConfig,
} from "@remit/mail-oauth-service";
import { env } from "expect-env";
import { ssmBodySyncGate } from "./body-sync-gate.js";
import { imapWorkerConfigFromEnv, poolOptionsFromEnv } from "./config-env.js";
import { createConnectionPool } from "./connection-pool.js";
import { createConnectionScopeWithCredentials } from "./connection-scope.js";
import type { ProcessContext } from "./context.js";
import { s3AccountObjects } from "./s3-account-objects.js";
import { sqsWorkerQueues, workerQueueUrlsFromEnv } from "./sqs-queues.js";

export type LambdaContextParts = Omit<ProcessContext, "client">;

export const lambdaContextParts = (log: Logger): LambdaContextParts => ({
	queues: sqsWorkerQueues(workerQueueUrlsFromEnv()),
	pool: createConnectionPool(
		poolOptionsFromEnv(process.env),
		createConnectionScopeWithCredentials,
	),
	metrics: { imapFailure: recordImapFailure },
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
	bodySync: ssmBodySyncGate(env.BODY_SYNC_ENABLED_PARAMETER_NAME),
	accountObjects: s3AccountObjects(() => env.S3_BUCKET_NAME),
});

export const withClient = (
	parts: LambdaContextParts,
): (() => Promise<ProcessContext>) => {
	let context: Promise<ProcessContext> | undefined;
	return () => {
		context ??= getClient().then((client) => ({ ...parts, client }));
		return context;
	};
};
