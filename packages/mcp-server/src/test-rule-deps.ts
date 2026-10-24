import { MailboxQueueService } from "@remit/mailbox-service";
import {
	type Store,
	silentLog,
} from "@remit/mailbox-service/test-helpers/test-store";
import type { McpDeps } from "./deps.js";

export const MAILBOX_QUEUE = "http://localhost:9324/000000000000/mailbox-mgmt";
export const ORGANIZE_QUEUE =
	"http://localhost:9324/000000000000/account-fanout";

export const ruleDeps = (
	store: Store,
): Pick<McpDeps, "folders" | "filters"> => ({
	folders: {
		mailboxQueue: new MailboxQueueService({
			mailboxService: store.mailbox,
			sqsQueueUrl: MAILBOX_QUEUE,
		}),
		settleTimeoutMs: 100,
		pollIntervalMs: 10,
	},
	filters: { organizeQueueUrl: ORGANIZE_QUEUE, logger: silentLog },
});
