import { recordSmtpFailure } from "@remit/logger-lambda/metrics";
import {
	createMailOAuthService,
	microsoftProviderConfig,
} from "@remit/mail-oauth-service";
import { createSecretsService } from "@remit/secrets-service";
import { createKmsDataKeyProvider } from "@remit/secrets-service/kms";
import { directSmtpSocket } from "@remit/smtp-service";
import { attemptBudget } from "@remit/sqs-client/attempt-budget";
import { createStandardQueueProducer } from "@remit/sqs-client/producer";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";
import { buildDataPortsFromEnv } from "./data-ports.js";
import { createAttachmentReader } from "./handlers/attachment-storage.js";
import type { SendMessageContext } from "./handlers/send-message.js";

export const getSendMessageMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => attemptBudget("SEND_MESSAGE_MAX_ATTEMPTS", 3, processEnv);

export const buildLambdaSendContext =
	async (): Promise<SendMessageContext> => ({
		ports: await buildDataPortsFromEnv(),
		secrets: createSecretsService(createKmsDataKeyProvider(env.KMS_KEY_ID)),
		storage: createAttachmentReader(process.env, createStorageService),
		messageManagement: createStandardQueueProducer({
			queueUrl: env.SQS_QUEUE_URL_MESSAGE_MGMT,
		}),
		tokenService: createMailOAuthService(
			microsoftProviderConfig({
				clientId: process.env.MSOAUTH_CLIENT_ID ?? "",
				clientSecret: process.env.MSOAUTH_CLIENT_SECRET ?? "",
				overrides: process.env.MSOAUTH_TOKEN_ENDPOINT
					? { tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT }
					: undefined,
			}),
		),
		getSocket: directSmtpSocket,
		maxAttempts: getSendMessageMaxAttempts(),
		recordSmtpFailure,
	});
