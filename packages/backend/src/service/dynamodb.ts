import { buildDynamoDBClient } from "./compose-dynamodb.js";
import type { RemitClient } from "./create-remit-client.js";

export type {
	ConnectionScope,
	RemitClient,
} from "./create-remit-client.js";

let clientPromise: Promise<RemitClient> | null = null;

// The API process and the imap-worker share this composition root. DynamoDB is
// the default and the only backend statically wired here — the sole one a
// deployed Lambda ever runs. The relational backends are loaded through a
// dynamic import of their own composition module, so `@remit/remit-drizzle-
// service` and `drizzle-orm` never enter a Lambda bundle (both are `external`
// for the Lambda esbuild build; the relational path runs via `tsx` on the
// self-host stacks). `remit-lambda-bundles.test.ts` enforces this.
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
			clientPromise = Promise.resolve(buildDynamoDBClient());
		}
	}

	return clientPromise;
};

/** Reset the singleton — test use only. */
export const _resetForTest = (): void => {
	clientPromise = null;
};

/** Inject a (usually partial) client — test use only. */
export const _setClientForTest = (override: RemitClient): void => {
	clientPromise = Promise.resolve(override);
};
