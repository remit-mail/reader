import {
	AccountConfigRepo,
	AccountExportRequestRepo,
	AccountRepo,
	AccountSettingRepo,
	AddressRepo,
	CalendarCollectionRepo,
	CalendarEventIndexRepo,
	CalendarFeedTokenRepo,
	CalendarObjectRepo,
	CalendarSuggestionRepo,
	ConfigImportRepo,
	createSqliteDatabase,
	DrizzleCalendarUnitOfWork,
	DrizzleEnvelopeRepository,
	DrizzleFilterAnchorTransaction,
	DrizzleMessageFlagRepository,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	DrizzleUnitOfWork,
	FilterAnchorRepo,
	FilterRepo,
	LabelRepo,
	MailboxLockRepo,
	MailboxRepo,
	MailboxSpecialUseRepo,
	MessageFlagPushRepo,
	MessageLabelRepo,
	MessagePlacementMoveRepo,
	messageDataSchema,
	OrganizeJobRequestRepo,
	OutboxAttachmentRepo,
	OutboxMessageRepo,
	QuarantineRepo,
	runInTransaction,
	SenderSignerStandingRepo,
} from "@remit/drizzle-service";
import { env } from "expect-env";
import {
	buildSharedDeps,
	createRemitClient,
	type RemitClient,
	type RemitClientRepositories,
} from "./create-remit-client.js";

// The SQLite adapter composition (RFC 036). Every repo runs on the single
// serialized connection `createSqliteDatabase` opens (D3), so a plain repo
// write cannot bypass serialization and join an open transaction's savepoint,
// and `threadMessage` takes that same shared handle, so its writes enlist in
// the same unit-of-work transaction and the same write queue as everything
// else.
export const buildSqliteClient = async (): Promise<RemitClient> => {
	const sqliteDbPath = env.SQLITE_DB_PATH;

	const { db } = await createSqliteDatabase(messageDataSchema, {
		filename: sqliteDbPath,
	});
	const genericDb = db;
	const messageDataDb = db;

	const repositories: RemitClientRepositories = {
		accountConfig: new AccountConfigRepo(genericDb),
		account: new AccountRepo(genericDb),
		accountSetting: new AccountSettingRepo(genericDb),
		address: new AddressRepo(genericDb),
		mailbox: new MailboxRepo(genericDb),
		mailboxSpecialUse: new MailboxSpecialUseRepo(genericDb),
		mailboxLock: new MailboxLockRepo(genericDb),
		message: new DrizzleMessageRepository(messageDataDb),
		messageFlag: new DrizzleMessageFlagRepository(messageDataDb),
		outboxMessage: new OutboxMessageRepo(genericDb),
		outboxAttachment: new OutboxAttachmentRepo(genericDb),
		threadMessage: new DrizzleThreadMessageRepository(genericDb),
		envelope: new DrizzleEnvelopeRepository(messageDataDb),
		accountExportRequest: new AccountExportRequestRepo(genericDb),
		configImport: new ConfigImportRepo(genericDb),
		quarantine: new QuarantineRepo(genericDb),
		organizeJobRequest: new OrganizeJobRequestRepo(genericDb),
		placementMove: new MessagePlacementMoveRepo(genericDb),
		flagPush: new MessageFlagPushRepo(genericDb),
		filter: new FilterRepo(genericDb),
		filterAnchor: new FilterAnchorRepo(genericDb),
		filterAnchorTransaction: new DrizzleFilterAnchorTransaction(genericDb),
		label: new LabelRepo(genericDb),
		messageLabel: new MessageLabelRepo(genericDb),
		senderSignerStanding: new SenderSignerStandingRepo(genericDb),
		calendarCollection: new CalendarCollectionRepo(genericDb),
		calendarObject: new CalendarObjectRepo(genericDb),
		calendarEventIndex: new CalendarEventIndexRepo(genericDb),
		calendarFeedToken: new CalendarFeedTokenRepo(genericDb),
		calendarSuggestion: new CalendarSuggestionRepo(genericDb),
		calendarUnitOfWork: new DrizzleCalendarUnitOfWork(genericDb),
		unitOfWork: new DrizzleUnitOfWork(messageDataDb),
		writeSet: (run) => runInTransaction(genericDb, () => run()),
	};

	return createRemitClient({ repositories, ...buildSharedDeps() });
};
