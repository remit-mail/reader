import type { OperationHandler, OperationIds } from "../types.js";
import { MailboxDetailOperations, MailboxOperations } from "./mailbox.js";
import { MessageBulkOperations, MessageOperations } from "./message.js";
import { SyncOperations } from "./sync.js";
import { ThreadOperations } from "./thread.js";

// biome-ignore lint/suspicious/noExplicitAny: Types are narrowed downstream
export const handlers: Record<OperationIds, OperationHandler<any>> = {
	...MailboxOperations,
	...MailboxDetailOperations,
	...SyncOperations,
	...ThreadOperations,
	...MessageOperations,
	...MessageBulkOperations,
};
