import { setTimeout as sleep } from "node:timers/promises";
import type { RecordingQueue } from "@remit/data-ports/recording-queue";
import {
	fifoMailboxManagement,
	MailboxQueueService,
	MessageMoveService,
} from "@remit/mailbox-service";
import {
	type Store,
	silentLog,
} from "@remit/mailbox-service/test-helpers/test-store";
import type { McpDeps } from "./deps.js";

export const ruleDeps = (
	store: Store,
	queue: RecordingQueue,
): Pick<McpDeps, "folders" | "filters" | "messageMove"> => ({
	folders: {
		mailboxQueue: new MailboxQueueService({
			mailboxService: store.mailbox,
			enqueue: fifoMailboxManagement(queue.fifo),
		}),
		settleTimeoutMs: 100,
		pollIntervalMs: 10,
		sleep,
	},
	filters: {
		organizeQueue: queue,
		logger: silentLog,
	},
	messageMove: new MessageMoveService({
		messageService: store.message,
		mailboxService: store.mailbox,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		threadMessageService: store.threadMessage,
		addressService: store.address,
		queue: queue.fifo,
	}),
});
