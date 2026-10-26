import type { FifoQueueProducer, QueueProducer } from "@remit/data-ports";
import type { ImapEvent, WorkerEvent } from "./events.js";

export interface WorkerQueues {
	mailboxes: FifoQueueProducer<ImapEvent>;
	messages: FifoQueueProducer<ImapEvent>;
	flags: FifoQueueProducer<ImapEvent>;
	body: QueueProducer<ImapEvent>;
	mailboxManagement: QueueProducer<ImapEvent>;
	messageManagement: QueueProducer<WorkerEvent>;
}
