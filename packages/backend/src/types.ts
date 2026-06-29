import type { Context } from "openapi-backend";

type MatchPrefix<
	Prefix extends string,
	S extends string,
> = S extends `${Prefix}${infer _}` ? S : never;

export type OperationIds =
	| "MeOperations_deleteMe"
	| "MeOperations_listVipSuggestions"
	| "MeOperations_createExport"
	| "MeOperations_getExport"
	| "AdminAccountConfigOperations_adminFinalizeDelete"
	| "ConfigOperations_getConfig"
	| "AccountOperations_createAccount"
	| "AccountOperations_testConnection"
	| "AccountDetailOperations_updateAccount"
	| "AccountDetailOperations_deleteAccount"
	| "MicrosoftOAuthOperations_microsoftOAuthStart"
	| "MicrosoftOAuthOperations_microsoftOAuthCallback"
	| "MailboxOperations_listMailboxes"
	| "MailboxOperations_createMailbox"
	| "MailboxDetailOperations_getMailbox"
	| "MailboxDetailOperations_renameMailbox"
	| "MailboxDetailOperations_deleteMailbox"
	| "SyncOperations_triggerSync"
	| "SyncOperations_getSyncStatus"
	| "SemanticSearchOperations_semanticSearch"
	| "ThreadDetailOperations_listThreadMessages"
	| "UnifiedThreadOperations_listAllThreads"
	| "ThreadOperations_listThreads"
	| "ThreadOperations_searchThreads"
	| "MessageOperations_describeMessage"
	| "MessageOperations_getRawMessage"
	| "MessageOperations_updateMessageFlags"
	| "MessageBulkOperations_deleteMessages"
	| "MessageBulkOperations_moveMessages"
	| "MessageBulkOperations_updateFlags"
	| "MessageBulkOperations_copyMessages"
	| "TrashOperations_emptyTrash"
	| "OutboxOperations_createOutboxMessage"
	| "OutboxOperations_listOutboxMessages"
	| "OutboxDetailOperations_getOutboxMessage"
	| "OutboxDetailOperations_updateOutboxMessage"
	| "OutboxDetailOperations_deleteOutboxMessage"
	| "OutboxDetailOperations_sendOutboxMessage"
	| "AddressOperations_searchAddresses"
	| "AddressDetailOperations_updateAddress";

export type MeOperationIds = MatchPrefix<"MeOperations_", OperationIds>;

export type AdminAccountConfigOperationIds = MatchPrefix<
	"AdminAccountConfigOperations_",
	OperationIds
>;

export type ConfigOperationIds = MatchPrefix<"ConfigOperations_", OperationIds>;

export type AccountOperationIds = MatchPrefix<
	"AccountOperations_",
	OperationIds
>;

export type AccountDetailOperationIds = MatchPrefix<
	"AccountDetailOperations_",
	OperationIds
>;

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

export type UnifiedThreadOperationIds = MatchPrefix<
	"UnifiedThreadOperations_",
	OperationIds
>;

export type ThreadOperationIds = MatchPrefix<"ThreadOperations_", OperationIds>;

export type SemanticSearchOperationIds = MatchPrefix<
	"SemanticSearchOperations_",
	OperationIds
>;

export type MessageOperationIds = MatchPrefix<
	"MessageOperations_",
	OperationIds
>;

export type MessageBulkOperationIds = MatchPrefix<
	"MessageBulkOperations_",
	OperationIds
>;

export type TrashOperationIds = MatchPrefix<"TrashOperations_", OperationIds>;

export type OutboxOperationIds = MatchPrefix<"OutboxOperations_", OperationIds>;

export type OutboxDetailOperationIds = MatchPrefix<
	"OutboxDetailOperations_",
	OperationIds
>;

export type AddressOperationIds = MatchPrefix<
	"AddressOperations_",
	OperationIds
>;

export type AddressDetailOperationIds = MatchPrefix<
	"AddressDetailOperations_",
	OperationIds
>;

export type MicrosoftOAuthOperationIds = MatchPrefix<
	"MicrosoftOAuthOperations_",
	OperationIds
>;

// biome-ignore lint/suspicious/noExplicitAny: handler responses vary by operation
type HandlerResponse = Record<string, any>;
export type OperationHandler<_T extends OperationIds = OperationIds> = (
	context: Context,
) => Promise<HandlerResponse>;
