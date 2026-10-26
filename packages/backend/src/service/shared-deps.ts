import { nodeTransport } from "@remit/mailbox-service/node-transport";
import {
	createCachedDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import {
	createKmsDataKeyProvider,
	FAKE_KMS_KEY_ID,
} from "@remit/secrets-service/kms";
import { directSmtpSocket } from "@remit/smtp-service";
import {
	createFifoQueueProducer,
	createStandardQueueProducer,
} from "@remit/sqs-client/producer";
import { createStorageService } from "@remit/storage-service/s3";
import { env } from "expect-env";
import {
	passwordConnectionScope,
	type RemitClientSharedDeps,
} from "./create-remit-client.js";
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
	sync: createFifoQueueProducer({ queueUrl: urls.sync }),
	accountFanout: createStandardQueueProducer({ queueUrl: urls.accountFanout }),
	smtp: createStandardQueueProducer({ queueUrl: urls.smtp }),
	messageManagement: createStandardQueueProducer({
		queueUrl: urls.messageManagement,
	}),
	body: createStandardQueueProducer({ queueUrl: urls.body }),
});

export const buildSharedDeps = (
	queues: RemitClientQueues,
): RemitClientSharedDeps => {
	const imapTransport = nodeTransport();
	return {
		storage: createStorageService(),
		secrets: createSecretsService(
			createCachedDataKeyProvider(
				createKmsDataKeyProvider(process.env.KMS_KEY_ID ?? FAKE_KMS_KEY_ID),
			),
		),
		connectionScope: passwordConnectionScope(imapTransport),
		mailTransports: { imap: () => imapTransport, smtp: directSmtpSocket },
		queues,
	};
};
