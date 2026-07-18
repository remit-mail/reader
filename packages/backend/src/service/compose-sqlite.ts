import {
	AccountConfigRepo,
	AccountExportRequestRepo,
	AccountRepo,
	AccountSettingRepo,
	AddressRepo,
	createSqliteDatabase,
	DrizzleEnvelopeRepository,
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
	OutboxMessageRepo,
} from "@remit/drizzle-service";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "expect-env";
import {
	buildSharedDeps,
	createRemitClient,
	type RemitClient,
	type RemitClientRepositories,
} from "./create-remit-client.js";

// The SQLite backend (RFC 036). Mirrors the Postgres composition — the same
// dialect-neutral Drizzle repos, wired to one shared SQLite file instead of a
// Postgres server — with two differences the file topology forces (D3): every
// repo runs on the single serialized connection `createSqliteDatabase` opens
// (writes cannot bypass serialization, so a plain repo write never joins an
// open transaction's savepoint), and `threadMessage` takes that shared handle
// rather than its own connection string, so its writes enlist in the same
// unit-of-work transaction and the same write queue as everything else.
export const buildSqliteClient = async (): Promise<RemitClient> => {
	const sqliteDbPath = env.SQLITE_DB_PATH;

	const { db } = await createSqliteDatabase(messageDataSchema, {
		filename: sqliteDbPath,
	});
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;

	const messageDataDb = db as unknown as NodePgDatabase<
		typeof messageDataSchema
	>;

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
		threadMessage: new DrizzleThreadMessageRepository(genericDb),
		envelope: new DrizzleEnvelopeRepository(messageDataDb),
		accountExportRequest: new AccountExportRequestRepo(genericDb),
		organizeJobRequest: new OrganizeJobRequestRepo(genericDb),
		placementMove: new MessagePlacementMoveRepo(genericDb),
		flagPush: new MessageFlagPushRepo(genericDb),
		filter: new FilterRepo(genericDb),
		filterAnchor: new FilterAnchorRepo(genericDb),
		label: new LabelRepo(genericDb),
		messageLabel: new MessageLabelRepo(genericDb),
		unitOfWork: new DrizzleUnitOfWork(messageDataDb),
	};

	return createRemitClient({ repositories, ...buildSharedDeps() });
};
