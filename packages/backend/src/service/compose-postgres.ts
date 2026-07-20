import {
	AccountConfigRepo,
	AccountExportRequestRepo,
	AccountRepo,
	AccountSettingRepo,
	AddressRepo,
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
	QuarantineRepo,
} from "@remit/drizzle-service";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "expect-env";
import {
	buildSharedDeps,
	createRemitClient,
	type RemitClient,
	type RemitClientRepositories,
} from "./create-remit-client.js";

export const buildPostgresClient = (): RemitClient => {
	const pgConnectionUrl = env.PG_CONNECTION_URL;

	// One drizzle db instance shared across repos.
	// The schema is registered for message-data tables; i4 repos use the same
	// underlying connection and only need the builder API (no relational queries).
	const db = drizzle(pgConnectionUrl, { schema: messageDataSchema });
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
		threadMessage: new DrizzleThreadMessageRepository(pgConnectionUrl),
		envelope: new DrizzleEnvelopeRepository(messageDataDb),
		accountExportRequest: new AccountExportRequestRepo(genericDb),
		quarantine: new QuarantineRepo(genericDb),
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
