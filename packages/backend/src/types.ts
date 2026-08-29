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
	| "MeOperations_listQuarantine"
	| "ConfigOperations_getConfig"
	| "ConfigOperations_exportConfig"
	| "ConfigOperations_importConfig"
	| "SystemOperations_getSystemUpdate"
	| "SystemOperations_applySystemUpdate"
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
	| "FolderRoleOperations_appointFolderRole"
	| "FilterOperations_listFilters"
	| "FilterOperations_createFilter"
	| "FilterDetailOperations_getFilter"
	| "FilterDetailOperations_updateFilter"
	| "FilterDetailOperations_deleteFilter"
	| "LabelOperations_listLabels"
	| "LabelOperations_createLabel"
	| "LabelDetailOperations_getLabel"
	| "LabelDetailOperations_updateLabel"
	| "LabelDetailOperations_deleteLabel"
	| "OrganizeOperations_createOrganizeJob"
	| "OrganizeOperations_previewOrganize"
	| "OrganizeJobDetailOperations_getOrganizeJob"
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
	| "MessageBulkOperations_updateMessageLabels"
	| "MessageBulkOperations_reportSpam"
	| "MessageBulkOperations_notSpam"
	| "CalendarOperations_listCalendars"
	| "CalendarOperations_createCalendar"
	| "CalendarDetailOperations_getCalendar"
	| "CalendarDetailOperations_updateCalendar"
	| "CalendarDetailOperations_deleteCalendar"
	| "CalendarEventOperations_listCalendarEvents"
	| "CalendarEventOperations_createCalendarEvent"
	| "CalendarEventDetailOperations_getCalendarEvent"
	| "CalendarEventDetailOperations_updateCalendarEvent"
	| "CalendarEventDetailOperations_deleteCalendarEvent"
	| "CalendarFreeBusyOperations_listCalendarFreeBusy"
	| "TrashOperations_emptyTrash"
	| "OutboxOperations_createOutboxMessage"
	| "OutboxOperations_listOutboxMessages"
	| "OutboxDetailOperations_getOutboxMessage"
	| "OutboxDetailOperations_updateOutboxMessage"
	| "OutboxDetailOperations_deleteOutboxMessage"
	| "OutboxDetailOperations_sendOutboxMessage"
	| "OutboxDetailOperations_mintOutboxAttachment"
	| "OutboxAttachmentOperations_completeOutboxAttachment"
	| "AddressOperations_searchAddresses"
	| "AddressDetailOperations_updateAddress";

export type MeOperationIds = MatchPrefix<"MeOperations_", OperationIds>;

export type ConfigOperationIds = MatchPrefix<"ConfigOperations_", OperationIds>;

export type SystemOperationIds = MatchPrefix<"SystemOperations_", OperationIds>;

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

export type FolderRoleOperationIds = MatchPrefix<
	"FolderRoleOperations_",
	OperationIds
>;

export type FilterOperationIds = MatchPrefix<"FilterOperations_", OperationIds>;

export type FilterDetailOperationIds = MatchPrefix<
	"FilterDetailOperations_",
	OperationIds
>;

export type LabelOperationIds = MatchPrefix<"LabelOperations_", OperationIds>;

export type LabelDetailOperationIds = MatchPrefix<
	"LabelDetailOperations_",
	OperationIds
>;

export type OrganizeOperationIds = MatchPrefix<
	"OrganizeOperations_",
	OperationIds
>;

export type OrganizeJobDetailOperationIds = MatchPrefix<
	"OrganizeJobDetailOperations_",
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

export type CalendarOperationIds = MatchPrefix<
	"CalendarOperations_",
	OperationIds
>;

export type CalendarDetailOperationIds = MatchPrefix<
	"CalendarDetailOperations_",
	OperationIds
>;

export type CalendarEventOperationIds = MatchPrefix<
	"CalendarEventOperations_",
	OperationIds
>;

export type CalendarEventDetailOperationIds = MatchPrefix<
	"CalendarEventDetailOperations_",
	OperationIds
>;

export type CalendarFreeBusyOperationIds = MatchPrefix<
	"CalendarFreeBusyOperations_",
	OperationIds
>;

export type TrashOperationIds = MatchPrefix<"TrashOperations_", OperationIds>;

export type OutboxOperationIds = MatchPrefix<"OutboxOperations_", OperationIds>;

export type OutboxDetailOperationIds = MatchPrefix<
	"OutboxDetailOperations_",
	OperationIds
>;

export type OutboxAttachmentOperationIds = MatchPrefix<
	"OutboxAttachmentOperations_",
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
