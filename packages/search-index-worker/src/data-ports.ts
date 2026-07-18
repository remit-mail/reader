import type {
	IAccountRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import {
	AccountService,
	getClient,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
// Type-only: erased at build, so it carries no runtime dependency on
// drizzle-orm. The value import lives inside `buildPostgresDataPorts` as a
// dynamic `import()` — see the comment there for why.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface SearchIndexDataPorts {
	account: IAccountRepository;
	threadMessage: IThreadMessageRepository;
	/**
	 * Resolve the owning accountId for a message whose queue envelope carries no
	 * accountId of its own. The DynamoDB stream bridge resolves accountId at
	 * publish time, so every AWS search-index message already carries a real
	 * one — this hook is `undefined` there, and the handler uses the message's
	 * own `accountId` unchanged (see `prepareUpsert` in handler.ts).
	 *
	 * The Postgres outbox trigger fires from a plain `message_id`, so the pg
	 * relay (`remit-pg-index-worker`) has no accountId to attach; this hook
	 * derives it from the message's mailbox at consume time instead. Returns
	 * null when the mailbox can't be resolved (the message is skipped, not
	 * retried — see handler.ts).
	 */
	resolveAccountId?: (messageId: string) => Promise<string | null>;
}

const buildDynamoDBDataPorts = (): SearchIndexDataPorts => {
	const tableName = process.env.DYNAMODB_TABLE_NAME;
	if (!tableName) throw new Error("DYNAMODB_TABLE_NAME is required");

	// getClient targets local DynamoDB in dev/test and default credentials in
	// prod, so the same worker logic drains the local search-index queue (via the
	// e2e-processor-shim) and the production SQS event-source mapping.
	const client = getClient();
	return {
		account: new AccountService({ client, table: tableName }),
		threadMessage: new ThreadMessageService({ client, table: tableName }),
	};
};

// `@remit/drizzle-service` and `drizzle-orm/node-postgres` are loaded
// lazily, inside this function, instead of as static top-level imports. This
// branch only ever runs when `DATA_BACKEND === "postgres"` — true for the
// local Postgres-parity dev stack, never on the deployed Lambda — but a static
// import is bundled (and evaluated at module load) regardless of whether the
// branch that uses it ever runs. `@remit/drizzle-service` and
// `drizzle-orm` are marked `external` for the Lambda esbuild build (see
// LAMBDA_ESBUILD_OPTIONS), so esbuild leaves this `import()` unresolved in the
// bundle; it is only ever reached — and only ever needs to resolve — on the
// Postgres path, which runs via `tsx` (no bundling, real module resolution)
// and always has both packages installed. Mirrors
// `packages/remit-backend/src/service/dynamodb.ts`'s `buildPostgresClient`.
const buildPostgresDataPorts = async (): Promise<SearchIndexDataPorts> => {
	const pgConnectionUrl = process.env.PG_CONNECTION_URL;
	if (!pgConnectionUrl) throw new Error("PG_CONNECTION_URL is required");

	const {
		AccountRepo,
		DrizzleMessageRepository,
		DrizzleThreadMessageRepository,
		MailboxRepo,
		messageDataSchema,
	} = await import("@remit/drizzle-service");
	const { drizzle } = await import("drizzle-orm/node-postgres");

	const db = drizzle(pgConnectionUrl, { schema: messageDataSchema });
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;
	const messageDataDb = db as unknown as NodePgDatabase<
		typeof messageDataSchema
	>;

	const message = new DrizzleMessageRepository(messageDataDb);
	const mailbox = new MailboxRepo(genericDb);

	return {
		account: new AccountRepo(genericDb),
		threadMessage: new DrizzleThreadMessageRepository(pgConnectionUrl),
		resolveAccountId: async (messageId) => {
			const row = await message.get(messageId);
			return mailbox.resolveAccountId(row.mailboxId);
		},
	};
};

// The SQLite twin of `buildPostgresDataPorts` (RFC 036): the same Drizzle repos
// over the one shared SQLite file instead of a Postgres connection string.
// `createSqliteDatabase` (and better-sqlite3 behind it) is kept external from
// this worker's DynamoDB Lambda bundle by the same dynamic-import treatment.
const buildSqliteDataPorts = async (): Promise<SearchIndexDataPorts> => {
	const sqliteDbPath = process.env.SQLITE_DB_PATH;
	if (!sqliteDbPath) throw new Error("SQLITE_DB_PATH is required");

	const {
		AccountRepo,
		createSqliteDatabase,
		DrizzleMessageRepository,
		DrizzleThreadMessageRepository,
		MailboxRepo,
		messageDataSchema,
	} = await import("@remit/drizzle-service");

	const { db } = await createSqliteDatabase(messageDataSchema, {
		filename: sqliteDbPath,
	});
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;
	const messageDataDb = db as unknown as NodePgDatabase<
		typeof messageDataSchema
	>;

	const message = new DrizzleMessageRepository(messageDataDb);
	const mailbox = new MailboxRepo(genericDb);

	return {
		account: new AccountRepo(genericDb),
		threadMessage: new DrizzleThreadMessageRepository(genericDb),
		resolveAccountId: async (messageId) => {
			const row = await message.get(messageId);
			return mailbox.resolveAccountId(row.mailboxId);
		},
	};
};

/**
 * Select the account + threadMessage data ports from the environment, mirroring
 * `buildVectorStoreFromEnv`'s `DATA_BACKEND` selection so one handler serves
 * the DynamoDB (AWS, production), Postgres (pg-parity), and SQLite
 * (single-box, RFC 036) stacks:
 *
 * - `DATA_BACKEND=postgres` → Drizzle repos over `PG_CONNECTION_URL`.
 * - `DATA_BACKEND=sqlite` → Drizzle repos over the shared `SQLITE_DB_PATH` file.
 * - otherwise → ElectroDB services over `DYNAMODB_TABLE_NAME` (unchanged from
 *   the pre-convergence worker — this is the production path).
 */
// `async` (not a plain arrow returning a Promise) so a synchronous throw in
// `buildDynamoDBDataPorts` (a missing `DYNAMODB_TABLE_NAME`) becomes a
// rejected promise instead of throwing before any promise exists — callers
// (including `getServices`) always get a promise to await.
export const buildDataPortsFromEnv =
	async (): Promise<SearchIndexDataPorts> => {
		if (process.env.DATA_BACKEND === "postgres")
			return buildPostgresDataPorts();
		if (process.env.DATA_BACKEND === "sqlite") return buildSqliteDataPorts();
		return buildDynamoDBDataPorts();
	};
