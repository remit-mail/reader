import type { FifoQueueProducer, QueueProducer } from "@remit/data-ports";
import { createQueueProducer } from "@remit/sqs-client/producer";
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
	mailboxes: createQueueProducer({ queueUrl: urls.mailboxes }),
	messages: createQueueProducer({ queueUrl: urls.messages }),
	flags: createQueueProducer({ queueUrl: urls.flags }),
	body: createQueueProducer({ queueUrl: urls.body }),
	mailboxManagement: createQueueProducer({ queueUrl: urls.mailboxManagement }),
	messageManagement: createQueueProducer({ queueUrl: urls.messageManagement }),
});

let composed: WorkerQueues | null = null;

/** Register the worker's queues from its entry, before the first event. */
export const setWorkerQueues = (queues: WorkerQueues): void => {
	composed = queues;
};

export const workerQueues = (): WorkerQueues => {
	if (!composed) {
		throw new Error(
			"no worker queues registered — register them with setWorkerQueues() from the entry",
		);
	}
	return composed;
};
