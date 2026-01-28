import type { OperationHandler, OperationIds } from "../types.js";
import { ConfigOperations } from "./config.js";
import { MailboxDetailOperations, MailboxOperations } from "./mailbox.js";
import { MessageBulkOperations, MessageOperations } from "./message.js";
import { SyncOperations } from "./sync.js";
import { ThreadDetailOperations, ThreadOperations } from "./thread.js";

// biome-ignore lint/suspicious/noExplicitAny: Types are narrowed downstream
export const handlers: Record<OperationIds, OperationHandler<any>> = {
	...ConfigOperations,
	...MailboxOperations,
	...MailboxDetailOperations,
	...SyncOperations,
	...ThreadDetailOperations,
	...ThreadOperations,
	...MessageOperations,
	...MessageBulkOperations,
};
