import type { FifoQueueProducer, QueueProducer } from "@remit/data-ports";
import {
	createFifoQueueProducer,
	createStandardQueueProducer,
} from "@remit/sqs-client/producer";
import { env } from "expect-env";
import type { ImapEvent, WorkerEvent } from "./events.js";

export interface WorkerQueues {
	mailboxes: FifoQueueProducer<ImapEvent>;
	messages: FifoQueueProducer<ImapEvent>;
	flags: FifoQueueProducer<ImapEvent>;
	body: QueueProducer<ImapEvent>;
	mailboxManagement: QueueProducer<ImapEvent>;
	messageManagement: QueueProducer<WorkerEvent>;
}

export type WorkerQueueUrls = Record<keyof WorkerQueues, string>;

export const workerQueueUrlsFromEnv = (): WorkerQueueUrls => ({
	mailboxes: env.SQS_QUEUE_URL_MAILBOXES,
	messages: env.SQS_QUEUE_URL_MESSAGES,
	flags: env.SQS_QUEUE_URL_FLAGS,
	body: env.SQS_QUEUE_URL_BODY,
	mailboxManagement: env.SQS_QUEUE_URL_MAILBOX_MGMT,
	messageManagement: env.SQS_QUEUE_URL_MESSAGE_MGMT,
});

export const sqsWorkerQueues = (urls: WorkerQueueUrls): WorkerQueues => ({
	mailboxes: createFifoQueueProducer({ queueUrl: urls.mailboxes }),
	messages: createFifoQueueProducer({ queueUrl: urls.messages }),
	flags: createFifoQueueProducer({ queueUrl: urls.flags }),
	body: createStandardQueueProducer({ queueUrl: urls.body }),
	mailboxManagement: createStandardQueueProducer({
		queueUrl: urls.mailboxManagement,
	}),
	messageManagement: createStandardQueueProducer({
		queueUrl: urls.messageManagement,
	}),
});
