import type { RemitClient } from "./create-remit-client.js";

export type {
	ConnectionScope,
	RemitClient,
} from "./create-remit-client.js";

let clientPromise: Promise<RemitClient> | null = null;
let injected: RemitClient | null = null;

/**
 * Register the client from the composition root. An adapter that lives outside
 * this shared, open-core module — DynamoDB, or a Postgres adapter in the
 * repository that deploys it — is never imported here; its composition root
 * calls this before handling a request.
 */
export const setClient = (client: RemitClient): void => {
	injected = client;
	clientPromise = null;
};

/**
 * The SQLite composition this build contains, reached only by a process that
 * registered no client of its own. The `import()` is dynamic so a bundler
 * following the entry graph of a process that injects its client never reaches
 * `@remit/drizzle-service` or drizzle-orm (both `external` for the Lambda
 * esbuild build).
 *
 * `SQLITE_DB_PATH` is the precondition the composition needs, checked ahead of
 * the import so its absence names `setClient` instead of failing on module
 * resolution inside a bundle, or — worse — opening an empty database and
 * serving an empty mailbox. It is a precondition, not a backend selection.
 */
const buildRelationalClient = async (): Promise<RemitClient> => {
	if (!process.env.SQLITE_DB_PATH) {
		throw new Error(
			"no client registered — register one with setClient() from your composition root",
		);
	}
	const composition = await import("./compose-sqlite.js");
	return composition.buildSqliteClient();
};

export const getClient = (): Promise<RemitClient> => {
	if (!clientPromise) {
		clientPromise = injected
			? Promise.resolve(injected)
			: buildRelationalClient();
	}

	return clientPromise;
};

/** Reset the singleton and any injected client — test use only. */
export const _resetForTest = (): void => {
	clientPromise = null;
	injected = null;
};
