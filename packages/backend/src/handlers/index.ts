import type { OperationHandler, OperationIds } from "../types.js";
import { AccountDetailOperations, AccountOperations } from "./account.js";
import { AddressDetailOperations, AddressOperations } from "./address.js";
import { ConfigOperations } from "./config.js";
import {
	MailboxDetailOperations,
	MailboxOperations,
	TrashOperations,
} from "./mailbox.js";
import { MessageBulkOperations, MessageOperations } from "./message.js";
import { OutboxDetailOperations, OutboxOperations } from "./outbox.js";
import { SyncOperations } from "./sync.js";
import { ThreadDetailOperations, ThreadOperations } from "./thread.js";

// biome-ignore lint/suspicious/noExplicitAny: Types are narrowed downstream
export const handlers: Record<OperationIds, OperationHandler<any>> = {
	...ConfigOperations,
	...AccountOperations,
	...AccountDetailOperations,
	...MailboxOperations,
	...MailboxDetailOperations,
	...TrashOperations,
	...SyncOperations,
	...ThreadDetailOperations,
	...ThreadOperations,
	...MessageOperations,
	...MessageBulkOperations,
	...OutboxOperations,
	...OutboxDetailOperations,
	...AddressOperations,
	...AddressDetailOperations,
};
