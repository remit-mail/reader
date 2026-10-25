import type { RecordingQueue } from "@remit/data-ports/recording-queue";
import {
	fifoMailboxManagement,
	MailboxQueueService,
} from "@remit/mailbox-service";
import {
	type Store,
	silentLog,
} from "@remit/mailbox-service/test-helpers/test-store";
import type { McpDeps } from "./deps.js";

export const ruleDeps = (
	store: Store,
	queue: RecordingQueue,
): Pick<McpDeps, "folders" | "filters"> => ({
	folders: {
		mailboxQueue: new MailboxQueueService({
			mailboxService: store.mailbox,
			enqueue: fifoMailboxManagement(queue.fifo),
		}),
		settleTimeoutMs: 100,
		pollIntervalMs: 10,
	},
	filters: {
		organizeQueue: queue,
		logger: silentLog,
	},
});
