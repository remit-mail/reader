import type { ApiRegistry } from "../serve.js";
import type { QueueName } from "../service/queues.js";
import type { handlers } from "./index.js";

type Handlers = typeof handlers;

type Registers<K extends QueueName, Op extends keyof Handlers> =
	Pick<Handlers, Op> extends ApiRegistry<K>["handlers"] ? true : false;

type ReadPathOperationIds =
	| "MailboxOperations_listMailboxes"
	| "MailboxDetailOperations_getMailbox"
	| "ConfigOperations_exportConfig"
	| "SyncOperations_getSyncStatus"
	| "AddressOperations_searchAddresses"
	| "ThreadOperations_listThreads"
	| "OutboxOperations_listOutboxMessages";

export const readPathRegistersWithoutQueues: Registers<
	never,
	ReadPathOperationIds
> = true;

export const outboxSendNeedsSmtp: Registers<
	never,
	"OutboxDetailOperations_sendOutboxMessage"
> = false;

export const outboxSendRegistersWithSmtp: Registers<
	"smtp",
	"OutboxDetailOperations_sendOutboxMessage"
> = true;

export const configReadNeedsSync: Registers<
	never,
	"ConfigOperations_getConfig"
> = false;

export const messageReadNeedsReadPathQueues: Registers<
	"sync" | "messageManagement",
	"MessageOperations_describeMessage"
> = false;
