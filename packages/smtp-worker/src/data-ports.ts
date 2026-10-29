import { createStorageService } from "@remit/storage-service/s3";
import type { SmtpDataPorts } from "./ports.js";

export type { SmtpDataPorts } from "./ports.js";

// `@remit/drizzle-service` is loaded lazily, inside this function, instead of as
// a static top-level import. A static import is bundled (and evaluated at module
// load) regardless of whether the branch that uses it ever runs; the package is
// marked `external` for the Lambda esbuild build (LAMBDA_ESBUILD_OPTIONS), so
// esbuild leaves this `import()` unresolved in the bundle. It resolves only
// where the relational composition actually runs, which has the package
// installed.
const buildSqliteDataPorts = async (): Promise<SmtpDataPorts> => {
	const {
		BETTER_SQLITE3_LIMITS,
		createSqliteRepositories,
		openSqliteDatabases,
		sqliteDatabasePathsFromEnv,
	} = await import("@remit/drizzle-service");

	const repositories = createSqliteRepositories(
		await openSqliteDatabases(sqliteDatabasePathsFromEnv()),
		BETTER_SQLITE3_LIMITS,
		{
			storage: createStorageService(),
		},
	);

	return {
		account: repositories.account,
		outboxMessage: repositories.outboxMessage,
		outboxAttachment: repositories.outboxAttachment,
		address: repositories.address,
		message: repositories.message,
		envelope: repositories.envelope,
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
 * contains. `SQLITE_APP_DB_PATH` is that composition's precondition, not a backend
 * selection.
 */
export const buildDataPortsFromEnv = async (): Promise<SmtpDataPorts> => {
	if (injectedDataPorts) return injectedDataPorts;
	if (process.env.SQLITE_APP_DB_PATH) return buildSqliteDataPorts();
	throw new Error(
		"no SMTP data ports registered — register them with setSmtpDataPorts() from your composition root",
	);
};
