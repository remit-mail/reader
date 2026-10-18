import type { Db } from "./db.js";
import { CalendarCollectionRepo } from "./repos/calendar-collection.js";
import { CalendarEventIndexRepo } from "./repos/calendar-event-index.js";
import { CalendarFeedTokenRepo } from "./repos/calendar-feed-token.js";
import { CalendarObjectRepo } from "./repos/calendar-object.js";
import { CalendarSuggestionRepo } from "./repos/calendar-suggestion.js";
import { DrizzleCalendarUnitOfWork } from "./repos/calendar-unit-of-work.js";
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
import { DrizzleUnitOfWork } from "./repos/unit-of-work.js";
import type { MessageDataSchema } from "./schema/message-data.js";
import { runInTransaction } from "./tx.js";

// Every repo over the one serialized SQLite connection (RFC 036 D3), so a plain
// repo write and a unit-of-work transaction share one write queue.
export const createSqliteRepositories = (db: Db<MessageDataSchema>) => ({
	accountConfig: new AccountConfigRepo(db),
	account: new AccountRepo(db),
	accountSetting: new AccountSettingRepo(db),
	address: new AddressRepo(db),
	mailbox: new MailboxRepo(db),
	mailboxSpecialUse: new MailboxSpecialUseRepo(db),
	mailboxLock: new MailboxLockRepo(db),
	message: new DrizzleMessageRepository(db),
	messageFlag: new DrizzleMessageFlagRepository(db),
	outboxMessage: new OutboxMessageRepo(db),
	outboxAttachment: new OutboxAttachmentRepo(db),
	threadMessage: new DrizzleThreadMessageRepository(db),
	envelope: new DrizzleEnvelopeRepository(db),
	accountExportRequest: new AccountExportRequestRepo(db),
	configImport: new ConfigImportRepo(db),
	quarantine: new QuarantineRepo(db),
	syncWarning: new SyncWarningRepo(db),
	organizeJobRequest: new OrganizeJobRequestRepo(db),
	placementMove: new MessagePlacementMoveRepo(db),
	flagPush: new MessageFlagPushRepo(db),
	filter: new FilterRepo(db),
	label: new LabelRepo(db),
	messageLabel: new MessageLabelRepo(db),
	senderSignerStanding: new SenderSignerStandingRepo(db),
	calendarCollection: new CalendarCollectionRepo(db),
	calendarObject: new CalendarObjectRepo(db),
	calendarEventIndex: new CalendarEventIndexRepo(db),
	calendarFeedToken: new CalendarFeedTokenRepo(db),
	calendarSuggestion: new CalendarSuggestionRepo(db),
	calendarUnitOfWork: new DrizzleCalendarUnitOfWork(db),
	unitOfWork: new DrizzleUnitOfWork(db),
	writeSet: <T>(run: () => Promise<T>): Promise<T> =>
		runInTransaction(db, () => run()),
});

export type SqliteRepositories = ReturnType<typeof createSqliteRepositories>;
