import {
	createCachedDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import {
	createKmsDataKeyProvider,
	FAKE_KMS_KEY_ID,
} from "@remit/secrets-service/kms";
import { createQueueProducer } from "@remit/sqs-client/producer";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";
import type { RemitClientSharedDeps } from "./create-remit-client.js";
import type { QueueName, RemitClientQueues } from "./queues.js";

export type SqsQueueUrls = Record<QueueName, string>;

export const sqsQueueUrlsFromEnv = (): SqsQueueUrls => ({
	sync: env.SQS_QUEUE_URL,
	accountFanout: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
	smtp: env.SQS_QUEUE_URL_SMTP,
	messageManagement: env.SQS_QUEUE_URL_MESSAGE_MGMT,
	body: env.SQS_QUEUE_URL_BODY,
});

export const sqsQueues = (urls: SqsQueueUrls): RemitClientQueues => ({
	sync: createQueueProducer({ queueUrl: urls.sync }),
	accountFanout: createQueueProducer({ queueUrl: urls.accountFanout }),
	smtp: createQueueProducer({ queueUrl: urls.smtp }),
	messageManagement: createQueueProducer({ queueUrl: urls.messageManagement }),
	body: createQueueProducer({ queueUrl: urls.body }),
});

export const buildSharedDeps = (
	queues: RemitClientQueues,
): RemitClientSharedDeps => ({
	storage: createStorageService(),
	secrets: createSecretsService(
		createCachedDataKeyProvider(
			createKmsDataKeyProvider(process.env.KMS_KEY_ID ?? FAKE_KMS_KEY_ID),
		),
	),
	queues,
});
