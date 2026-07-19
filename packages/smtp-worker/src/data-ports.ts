import type {
	IAccountRepository,
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IOutboxMessageRepository,
} from "@remit/data-ports";
// Type-only: erased at build, so it carries no runtime dependency on
// drizzle-orm. The value import lives inside the relational builders as a
// dynamic `import()` — see the comment there for why.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * The repositories the SMTP send path reads and writes. One neutral seam over
 * the three backends (DynamoDB / Postgres / SQLite), selected by
 * `buildDataPortsFromEnv` so the same handler serves every stack.
 */
export interface SmtpDataPorts {
	account: IAccountRepository;
	outboxMessage: IOutboxMessageRepository;
	address: IAddressRepository;
	message: IMessageRepository;
	envelope: IEnvelopeRepository;
}

// `@remit/drizzle-service` and `drizzle-orm/node-postgres` are loaded
// lazily, inside these functions, instead of as static top-level imports. The
// relational branches only ever run when `DATA_BACKEND` selects them — never on
// the deployed Lambda — but a static import is bundled (and evaluated at module
// load) regardless of whether its branch runs. Both packages are marked
// `external` for the Lambda esbuild build (LAMBDA_ESBUILD_OPTIONS), so esbuild
// leaves this `import()` unresolved in the bundle; it resolves only on the
// relational path, which runs via `tsx`/the container bundle with both packages
// installed. Mirrors the search-index-worker data-ports seam.
const buildPostgresDataPorts = async (): Promise<SmtpDataPorts> => {
	const pgConnectionUrl = process.env.PG_CONNECTION_URL;
	if (!pgConnectionUrl) throw new Error("PG_CONNECTION_URL is required");

	const {
		AccountRepo,
		AddressRepo,
		DrizzleEnvelopeRepository,
		DrizzleMessageRepository,
		messageDataSchema,
		OutboxMessageRepo,
	} = await import("@remit/drizzle-service");
	const { drizzle } = await import("drizzle-orm/node-postgres");

	const db = drizzle(pgConnectionUrl, { schema: messageDataSchema });
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;
	const messageDataDb = db as unknown as NodePgDatabase<
		typeof messageDataSchema
	>;

	return {
		account: new AccountRepo(genericDb),
		outboxMessage: new OutboxMessageRepo(genericDb),
		address: new AddressRepo(genericDb),
		message: new DrizzleMessageRepository(messageDataDb),
		envelope: new DrizzleEnvelopeRepository(messageDataDb),
	};
};

// The SQLite twin of `buildPostgresDataPorts` (RFC 036): the same Drizzle repos
// over the one shared SQLite file. `createSqliteDatabase` (and better-sqlite3
// behind it) is kept external from the DynamoDB Lambda bundle by the same
// dynamic-import treatment.
const buildSqliteDataPorts = async (): Promise<SmtpDataPorts> => {
	const sqliteDbPath = process.env.SQLITE_DB_PATH;
	if (!sqliteDbPath) throw new Error("SQLITE_DB_PATH is required");

	const {
		AccountRepo,
		AddressRepo,
		createSqliteDatabase,
		DrizzleEnvelopeRepository,
		DrizzleMessageRepository,
		messageDataSchema,
		OutboxMessageRepo,
	} = await import("@remit/drizzle-service");

	const { db } = await createSqliteDatabase(messageDataSchema, {
		filename: sqliteDbPath,
	});
	const genericDb = db as unknown as NodePgDatabase<Record<string, unknown>>;
	const messageDataDb = db as unknown as NodePgDatabase<
		typeof messageDataSchema
	>;

	return {
		account: new AccountRepo(genericDb),
		outboxMessage: new OutboxMessageRepo(genericDb),
		address: new AddressRepo(genericDb),
		message: new DrizzleMessageRepository(messageDataDb),
		envelope: new DrizzleEnvelopeRepository(messageDataDb),
	};
};

/**
 * Select the SMTP data ports from the environment, mirroring the other workers'
 * `DATA_BACKEND` selection:
 *
 * - `DATA_BACKEND=postgres` → Drizzle repos over `PG_CONNECTION_URL`.
 * - `DATA_BACKEND=sqlite` → Drizzle repos over the shared `SQLITE_DB_PATH` file.
 * - otherwise → ElectroDB services over `DYNAMODB_TABLE_NAME` (the AWS path,
 *   unchanged from the pre-convergence worker).
 *
 * The DynamoDB branch loads its composition through a dynamic `import()`, so the
 * sole importer of the closed `@remit/remit-electrodb-service`
 * (`./compose-dynamodb.js`) is never loaded on the relational (open-core) tree,
 * where that module is not shipped. esbuild still bundles it into the Lambda
 * because the specifier is a relative import, not an `external`.
 */
export const buildDataPortsFromEnv = async (): Promise<SmtpDataPorts> => {
	if (process.env.DATA_BACKEND === "postgres") return buildPostgresDataPorts();
	if (process.env.DATA_BACKEND === "sqlite") return buildSqliteDataPorts();
	// `as string` stops tsgo resolving the module in the open-core tree, which
	// strips it; the named contract keeps the call site typed rather than `any`.
	type ComposeDynamoDBModule = {
		buildDynamoDBDataPorts: () => SmtpDataPorts;
	};
	const { buildDynamoDBDataPorts } = (await import(
		"./compose-dynamodb.js" as string
	)) as ComposeDynamoDBModule;
	return buildDynamoDBDataPorts();
};
