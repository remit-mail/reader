import type { SqliteDatabases } from "./databases.js";
import { CalendarCollectionRepo } from "./repos/calendar-collection.js";
import { CalendarEventIndexRepo } from "./repos/calendar-event-index.js";
import { CalendarFeedTokenRepo } from "./repos/calendar-feed-token.js";
import { CalendarObjectRepo } from "./repos/calendar-object.js";
import { DrizzleCalendarStore } from "./repos/calendar-store.js";
import { CalendarSuggestionRepo } from "./repos/calendar-suggestion.js";
import { DrizzleEnvelopeRepository } from "./repos/envelope.js";
import { FilterRepo } from "./repos/filter.js";
import { AccountRepo } from "./repos/i4-account.js";
import { AccountConfigRepo } from "./repos/i4-account-config.js";
import { AccountExportRequestRepo } from "./repos/i4-account-export-request.js";
import { AccountSettingRepo } from "./repos/i4-account-setting.js";
import { AddressRepo } from "./repos/i4-address.js";
import { ConfigImportRepo } from "./repos/i4-config-import.js";
import { MailboxRepo } from "./repos/i4-mailbox.js";
import { MailboxLockRepo } from "./repos/i4-mailbox-lock.js";
import { MailboxSpecialUseRepo } from "./repos/i4-mailbox-special-use.js";
import { MessageFlagPushRepo } from "./repos/i4-message-flag-push.js";
import { MessagePlacementMoveRepo } from "./repos/i4-message-placement-move.js";
import { OrganizeJobRequestRepo } from "./repos/i4-organize-job-request.js";
import { OutboxAttachmentRepo } from "./repos/i4-outbox-attachment.js";
import { OutboxMessageRepo } from "./repos/i4-outbox-message.js";
import { SenderSignerStandingRepo } from "./repos/i4-sender-signer-standing.js";
import { LabelRepo } from "./repos/label.js";
import { DrizzleMessageRepository } from "./repos/message.js";
import { DrizzleMessageFlagRepository } from "./repos/message-flag.js";
import { MessageLabelRepo } from "./repos/message-label.js";
import { QuarantineRepo } from "./repos/quarantine.js";
import { SyncWarningRepo } from "./repos/sync-warning.js";
import { DrizzleThreadMessageRepository } from "./repos/thread-message.js";
import { SearchIndex } from "./search/thread-message-search.js";

// Every repo over the database that holds its tables (#1420).
export const createSqliteRepositories = ({
	app,
	mail,
	search,
}: SqliteDatabases) => {
	const searchIndex = new SearchIndex(mail, search);
	return {
		accountConfig: new AccountConfigRepo(app, mail),
		account: new AccountRepo(app, mail),
		accountSetting: new AccountSettingRepo(app),
		address: new AddressRepo(mail),
		mailbox: new MailboxRepo(mail, searchIndex),
		mailboxSpecialUse: new MailboxSpecialUseRepo(app, mail),
		mailboxLock: new MailboxLockRepo(mail),
		message: new DrizzleMessageRepository(mail, searchIndex),
		messageFlag: new DrizzleMessageFlagRepository(mail),
		outboxMessage: new OutboxMessageRepo(mail),
		outboxAttachment: new OutboxAttachmentRepo(mail),
		threadMessage: new DrizzleThreadMessageRepository(mail, searchIndex),
		envelope: new DrizzleEnvelopeRepository(mail),
		accountExportRequest: new AccountExportRequestRepo(app),
		configImport: new ConfigImportRepo(app),
		quarantine: new QuarantineRepo(mail),
		syncWarning: new SyncWarningRepo(mail),
		organizeJobRequest: new OrganizeJobRequestRepo(mail),
		placementMove: new MessagePlacementMoveRepo(mail),
		flagPush: new MessageFlagPushRepo(mail),
		filter: new FilterRepo(app),
		label: new LabelRepo(app),
		messageLabel: new MessageLabelRepo(mail),
		senderSignerStanding: new SenderSignerStandingRepo(mail),
		calendarCollection: new CalendarCollectionRepo(app),
		calendarObject: new CalendarObjectRepo(app),
		calendarEventIndex: new CalendarEventIndexRepo(app),
		calendarFeedToken: new CalendarFeedTokenRepo(app),
		calendarSuggestion: new CalendarSuggestionRepo(mail),
		calendarStore: new DrizzleCalendarStore(app, mail),
	};
};

export type SqliteRepositories = ReturnType<typeof createSqliteRepositories>;
