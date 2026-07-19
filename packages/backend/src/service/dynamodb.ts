import type { RemitClient } from "./create-remit-client.js";

export type {
	ConnectionScope,
	RemitClient,
} from "./create-remit-client.js";

let clientPromise: Promise<RemitClient> | null = null;
let injected: RemitClient | null = null;

/**
 * Register the DynamoDB-backed client from the composition root. The DynamoDB
 * composition lives outside this shared, open-core module and is never imported
 * here. Every DynamoDB entry point calls this before handling a request. The
 * relational backends compose in-package below and never touch this seam.
 */
export const setClient = (client: RemitClient): void => {
	injected = client;
	clientPromise = null;
};

// The API process and the imap-worker share this composition root. The
// relational backends are loaded through a lazy `import()` of their own
// in-package composition module, so the module a given deploy never runs never
// enters its graph: `@remit/drizzle-service`/`drizzle-orm` stay out of a
// Lambda bundle (both `external` for the Lambda esbuild build;
// `remit-lambda-bundles.test.ts` enforces this). The DynamoDB backend is
// injected by the composition root through `setClient`, so this module carries
// no import of the DynamoDB composition.
export const getClient = (): Promise<RemitClient> => {
	if (!clientPromise) {
		if (process.env.DATA_BACKEND === "postgres") {
			clientPromise = import("./compose-postgres.js").then((m) =>
				m.buildPostgresClient(),
			);
		} else if (process.env.DATA_BACKEND === "sqlite") {
			clientPromise = import("./compose-sqlite.js").then((m) =>
				m.buildSqliteClient(),
			);
		} else {
			if (!injected) {
				throw new Error(
					"no DynamoDB client registered — register one with setClient() from your composition root",
				);
			}
			clientPromise = Promise.resolve(injected);
		}
	}

	return clientPromise;
};

/** Reset the singleton and any injected client — test use only. */
export const _resetForTest = (): void => {
	clientPromise = null;
	injected = null;
};
