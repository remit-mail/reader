import type { Context } from "openapi-backend";

type MatchPrefix<
	Prefix extends string,
	S extends string,
> = S extends `${Prefix}${infer _}` ? S : never;

export type OperationIds =
	| "ConfigOperations_getConfig"
	| "MailboxOperations_listMailboxes"
	| "MailboxOperations_createMailbox"
	| "MailboxDetailOperations_getMailbox"
	| "MailboxDetailOperations_renameMailbox"
	| "MailboxDetailOperations_deleteMailbox"
	| "SyncOperations_triggerSync"
	| "ThreadDetailOperations_listThreadMessages"
	| "ThreadOperations_listThreads"
	| "ThreadOperations_searchThreads"
	| "MessageOperations_describeMessage"
	| "MessageOperations_updateMessageFlags"
	| "MessageBulkOperations_deleteMessages"
	| "MessageBulkOperations_moveMessages";

export type ConfigOperationIds = MatchPrefix<"ConfigOperations_", OperationIds>;

export type MailboxOperationIds = MatchPrefix<
	"MailboxOperations_",
	OperationIds
>;

export type MailboxDetailOperationIds = MatchPrefix<
	"MailboxDetailOperations_",
	OperationIds
>;

export type SyncOperationIds = MatchPrefix<"SyncOperations_", OperationIds>;

export type ThreadDetailOperationIds = MatchPrefix<
	"ThreadDetailOperations_",
	OperationIds
>;

export type ThreadOperationIds = MatchPrefix<"ThreadOperations_", OperationIds>;

export type MessageOperationIds = MatchPrefix<
	"MessageOperations_",
	OperationIds
>;

export type MessageBulkOperationIds = MatchPrefix<
	"MessageBulkOperations_",
	OperationIds
>;

// biome-ignore lint/suspicious/noExplicitAny: Handler responses vary by operation
export type OperationHandler<_T extends OperationIds = OperationIds> = (
	context: Context,
) => Promise<Record<string, any>>;
