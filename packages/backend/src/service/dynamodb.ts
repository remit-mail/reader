import type { RemitClient } from "./create-remit-client.js";

export type {
	ConnectionScope,
	RemitClient,
} from "./create-remit-client.js";

// The DynamoDB composition module is stripped from the open-core export (it
// imports the closed electrodb-service). The `as string` specifier keeps
// tsgo from resolving it there — where the file is absent — while this named
// contract keeps the call site typed rather than `any`. The relational tree
// never takes this branch; the DynamoDB deploy, where the module is present,
// resolves it at runtime.
type ComposeDynamoDBModule = { buildDynamoDBClient: () => RemitClient };

let clientPromise: Promise<RemitClient> | null = null;

// The API process and the imap-worker share this composition root. Each backend
// is loaded through a dynamic import of its own composition module, so the
// module that a given deploy never runs never enters its graph: `@remit/remit-
// drizzle-service`/`drizzle-orm` stay out of a Lambda bundle (both `external`
// for the Lambda esbuild build; `remit-lambda-bundles.test.ts` enforces this),
// and the DynamoDB composition — which imports the closed `@remit/remit-
// electrodb-service` — stays out of the relational (open-core) tree, where its
// module is not shipped at all. esbuild still bundles the DynamoDB path into
// the Lambda because `./compose-dynamodb.js` is a relative import, not an
// `external`.
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
			clientPromise = (
				import(
					"./compose-dynamodb.js" as string
				) as Promise<ComposeDynamoDBModule>
			).then((m) => m.buildDynamoDBClient());
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
