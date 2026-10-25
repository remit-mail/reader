import {
	type SqliteDatabases,
	type SqliteStores,
	syncStores,
} from "./databases.js";
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

// Every repo over the database that holds its tables (#1420), each writing its
// sets through that database's own batch port, so any SQLite driver serves.
export const composeSqliteRepositories = ({
	app,
	mail,
	search,
}: SqliteStores) => {
	const searchIndex = new SearchIndex(mail.db, search.db, search.batch);
	const accountSetting = new AccountSettingRepo(app.db);
	const address = new AddressRepo(mail.db);
	const mailbox = new MailboxRepo(mail.db, mail.batch, searchIndex);
	const account = new AccountRepo(app.db, mailbox);
	const calendarSuggestion = new CalendarSuggestionRepo(mail.db);
	return {
		accountConfig: new AccountConfigRepo(app.db, address),
		account,
		accountSetting,
		address,
		mailbox,
		mailboxSpecialUse: new MailboxSpecialUseRepo(
			mail.db,
			account,
			accountSetting,
		),
		mailboxLock: new MailboxLockRepo(mail.db),
		message: new DrizzleMessageRepository(mail.db, mail.batch, searchIndex),
		messageFlag: new DrizzleMessageFlagRepository(mail.db),
		outboxMessage: new OutboxMessageRepo(mail.db),
		outboxAttachment: new OutboxAttachmentRepo(mail.db, mail.batch),
		threadMessage: new DrizzleThreadMessageRepository(
			mail.db,
			mail.batch,
			searchIndex,
		),
		envelope: new DrizzleEnvelopeRepository(mail.db, mail.batch),
		accountExportRequest: new AccountExportRequestRepo(app.db),
		configImport: new ConfigImportRepo(app.db),
		quarantine: new QuarantineRepo(mail.db),
		syncWarning: new SyncWarningRepo(mail.db),
		organizeJobRequest: new OrganizeJobRequestRepo(mail.db),
		placementMove: new MessagePlacementMoveRepo(mail.db),
		flagPush: new MessageFlagPushRepo(mail.db),
		filter: new FilterRepo(app.db),
		label: new LabelRepo(app.db),
		messageLabel: new MessageLabelRepo(mail.db),
		senderSignerStanding: new SenderSignerStandingRepo(mail.db),
		calendarCollection: new CalendarCollectionRepo(app.db),
		calendarObject: new CalendarObjectRepo(app.db),
		calendarEventIndex: new CalendarEventIndexRepo(app.db),
		calendarFeedToken: new CalendarFeedTokenRepo(app.db),
		calendarSuggestion,
		calendarStore: new DrizzleCalendarStore(
			app.db,
			app.batch,
			calendarSuggestion,
		),
	};
};

export type SqliteRepositories = ReturnType<typeof composeSqliteRepositories>;

// The self-host composition: the three better-sqlite3 databases, each writing
// its sets as one synchronous IMMEDIATE transaction.
export const createSqliteRepositories = (
	databases: SqliteDatabases,
): SqliteRepositories => composeSqliteRepositories(syncStores(databases));
