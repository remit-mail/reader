import type {
	IAccountRepository,
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IOutboxMessageRepository,
} from "@remit/data-ports";

/**
 * The repositories the SMTP send path reads and writes. One neutral seam so the
 * same handler serves every stack.
 */
export interface SmtpDataPorts {
	account: IAccountRepository;
	outboxMessage: IOutboxMessageRepository;
	address: IAddressRepository;
	message: IMessageRepository;
	envelope: IEnvelopeRepository;
}

// `@remit/drizzle-service` is loaded lazily, inside this function, instead of as
// a static top-level import. A static import is bundled (and evaluated at module
// load) regardless of whether the branch that uses it ever runs; the package is
// marked `external` for the Lambda esbuild build (LAMBDA_ESBUILD_OPTIONS), so
// esbuild leaves this `import()` unresolved in the bundle. It resolves only
// where the relational composition actually runs, which has the package
// installed. Mirrors the search-index-worker data-ports seam.
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

	return {
		account: new AccountRepo(db),
		outboxMessage: new OutboxMessageRepo(db),
		address: new AddressRepo(db),
		message: new DrizzleMessageRepository(db),
		envelope: new DrizzleEnvelopeRepository(db),
	};
};

let injectedDataPorts: SmtpDataPorts | null = null;

/**
 * Register the DynamoDB-backed SMTP data ports from the composition root. The
 * DynamoDB composition lives outside this shared, open-core module and is never
 * imported here. The relational backend composes in-package above and never
 * touches this seam.
 */
export const setSmtpDataPorts = (ports: SmtpDataPorts): void => {
	injectedDataPorts = ports;
};

/**
 * The SMTP data ports for this process: the ones a composition root registered,
 * or — for a process that registered none — the SQLite composition this build
 * contains. `SQLITE_DB_PATH` is that composition's precondition, not a backend
 * selection.
 */
export const buildDataPortsFromEnv = async (): Promise<SmtpDataPorts> => {
	if (injectedDataPorts) return injectedDataPorts;
	if (process.env.SQLITE_DB_PATH) return buildSqliteDataPorts();
	throw new Error(
		"no SMTP data ports registered — register them with setSmtpDataPorts() from your composition root",
	);
};
