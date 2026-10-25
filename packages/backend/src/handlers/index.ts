import type {
	OperationHandler,
	OperationIds,
	PublicOperationHandler,
	PublicOperationIds,
} from "../types.js";
import { AccountDetailOperations, AccountOperations } from "./account.js";
import {
	MicrosoftOAuthOperations,
	microsoftOAuthCallback,
} from "./account-oauth.js";
import { AddressDetailOperations, AddressOperations } from "./address.js";
import { CalendarDetailOperations, CalendarOperations } from "./calendar.js";
import {
	CalendarEventDetailOperations,
	CalendarEventOperations,
	CalendarFreeBusyOperations,
} from "./calendar-event.js";
import {
	CalendarFeedDetailOperations,
	getCalendarFeedIcal,
} from "./calendar-feed.js";
import {
	CalendarSuggestionActionOperations,
	CalendarSuggestionOperations,
	MessageCalendarSuggestionOperations,
} from "./calendar-suggestion.js";
import { ConfigOperations } from "./config.js";
import { FilterDetailOperations, FilterOperations } from "./filter.js";
import { FolderRoleOperations } from "./folder-role.js";
import { LabelDetailOperations, LabelOperations } from "./label.js";
import {
	MailboxDetailOperations,
	MailboxOperations,
	TrashOperations,
} from "./mailbox.js";
import { MeOperations } from "./me.js";
import { MessageBulkOperations, MessageOperations } from "./message.js";
import { OrganizeJobDetailOperations, OrganizeOperations } from "./organize.js";
import {
	OutboxAttachmentOperations,
	OutboxDetailOperations,
	OutboxOperations,
} from "./outbox.js";
import { SyncOperations } from "./sync.js";
import { SystemOperations } from "./system-update.js";
import { ThreadDetailOperations, ThreadOperations } from "./thread.js";
import { UnifiedThreadOperations } from "./unified-threads.js";

export const handlers: Record<
	Exclude<OperationIds, PublicOperationIds>,
	OperationHandler
> = {
	...MeOperations,
	...ConfigOperations,
	...SystemOperations,
	...AccountOperations,
	...AccountDetailOperations,
	...MicrosoftOAuthOperations,
	...MailboxOperations,
	...MailboxDetailOperations,
	...FolderRoleOperations,
	...FilterOperations,
	...FilterDetailOperations,
	...LabelOperations,
	...LabelDetailOperations,
	...OrganizeOperations,
	...OrganizeJobDetailOperations,
	...CalendarOperations,
	...CalendarDetailOperations,
	...CalendarFeedDetailOperations,
	...CalendarEventOperations,
	...CalendarEventDetailOperations,
	...CalendarFreeBusyOperations,
	...TrashOperations,
	...SyncOperations,
	...ThreadDetailOperations,
	...UnifiedThreadOperations,
	...ThreadOperations,
	...MessageOperations,
	...MessageBulkOperations,
	...OutboxOperations,
	...OutboxDetailOperations,
	...OutboxAttachmentOperations,
	...AddressOperations,
	...AddressDetailOperations,
	...CalendarSuggestionOperations,
	...MessageCalendarSuggestionOperations,
	...CalendarSuggestionActionOperations,
};

export const publicHandlers: Record<
	PublicOperationIds,
	PublicOperationHandler
> = {
	MicrosoftOAuthOperations_microsoftOAuthCallback: microsoftOAuthCallback,
	CalendarFeedOperations_getCalendarFeedIcal: getCalendarFeedIcal,
};
