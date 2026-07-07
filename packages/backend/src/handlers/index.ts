import type { OperationHandler, OperationIds } from "../types.js";
import { AccountDetailOperations, AccountOperations } from "./account.js";
import { MicrosoftOAuthOperations } from "./account-oauth.js";
import { AddressDetailOperations, AddressOperations } from "./address.js";
import { ConfigOperations } from "./config.js";
import {
	MailboxDetailOperations,
	MailboxOperations,
	TrashOperations,
} from "./mailbox.js";
import { MeOperations } from "./me.js";
import { MessageBulkOperations, MessageOperations } from "./message.js";
import { OutboxDetailOperations, OutboxOperations } from "./outbox.js";
import { SemanticSearchOperations } from "./search.js";
import { SyncOperations } from "./sync.js";
import { ThreadDetailOperations, ThreadOperations } from "./thread.js";
import { UnifiedThreadOperations } from "./unified-threads.js";

// biome-ignore lint/suspicious/noExplicitAny: Types are narrowed downstream
export const handlers: Record<OperationIds, OperationHandler<any>> = {
	...MeOperations,
	...ConfigOperations,
	...AccountOperations,
	...AccountDetailOperations,
	...MicrosoftOAuthOperations,
	...MailboxOperations,
	...MailboxDetailOperations,
	...TrashOperations,
	...SyncOperations,
	...ThreadDetailOperations,
	...UnifiedThreadOperations,
	...ThreadOperations,
	...MessageOperations,
	...MessageBulkOperations,
	...OutboxOperations,
	...OutboxDetailOperations,
	...AddressOperations,
	...AddressDetailOperations,
	...SemanticSearchOperations,
};
