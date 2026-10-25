import type { RecordingQueue } from "@remit/data-ports/recording-queue";
import type { WorkerQueues } from "../queues.js";

export const workerQueuesOn = (queue: RecordingQueue): WorkerQueues => ({
	mailboxes: queue.fifo,
	messages: queue.fifo,
	flags: queue.fifo,
	body: queue,
	mailboxManagement: queue,
	messageManagement: queue,
});
