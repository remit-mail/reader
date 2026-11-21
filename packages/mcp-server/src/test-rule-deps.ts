import { setTimeout as sleep } from "node:timers/promises";
import type { RecordingQueue } from "@remit/data-ports/recording-queue";
import {
	type BodyPartMaterializer,
	type BodySyncCue,
	fifoMailboxManagement,
	MailboxQueueService,
	MessageMoveService,
} from "@remit/mailbox-service";
import {
	rescanServiceFor,
	type Store,
} from "@remit/mailbox-service/test-helpers/test-store";
import type { StorageService } from "@remit/storage-service";
import type { McpDeps } from "./deps.js";

export const ruleDeps = (
	client: McpDeps["client"],
): Pick<McpDeps, "calendarClient" | "client" | "folders" | "moves"> => ({
	calendarClient: () => undefined as never,
	client,
	folders: {
		settleTimeoutMs: 100,
		pollIntervalMs: 10,
		sleep,
	},
	moves: { budgetMs: 100, pollIntervalMs: 10, sleep, now: Date.now },
});

export const testClient = (
	store: Store,
	queue: RecordingQueue,
	storage: StorageService,
	bodySync: BodyPartMaterializer,
	bodySyncQueue: BodySyncCue,
): McpDeps["client"] =>
	({
		...store,
		storage,
		bodySync,
		bodySyncQueue,
		mailboxQueue: new MailboxQueueService({
			mailboxService: store.mailbox,
			enqueue: fifoMailboxManagement(queue.fifo),
		}),
		messageMove: new MessageMoveService({
			messageService: store.message,
			mailboxService: store.mailbox,
			mailboxSpecialUseService: store.mailboxSpecialUse,
			threadMessageService: store.threadMessage,
			addressService: store.address,
			queue: queue.fifo,
		}),
		rescan: rescanServiceFor(store, storage, queue),
		queues: { accountFanout: queue },
	}) as never;
