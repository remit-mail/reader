import type { Db } from "./db.js";

// The one place a SQLite connection is opened for the app (RFC 036 D3). Every
// writer container (backend, imap-worker, smtp-worker, account-worker) opens the
// same file here with the same cross-process settings — WAL for concurrent
// readers, a 5 s busy_timeout so a writer waits out another's short transaction
// instead of failing, synchronous=NORMAL (durable under WAL), foreign keys on.
//
// No write on this handle holds a transaction open across an `await`: a write
// set runs as one synchronous batch (`batch.ts`), so the shared connection is
// never inside another caller's transaction when a plain write lands.
//
// better-sqlite3 and its drizzle driver are imported dynamically so the whole
// module stays out of the DynamoDB Lambda bundle (this package is `external`
// there — see remit-backend/src/service/data-client.ts).

export interface SqliteClientOptions {
	filename: string;
}

export interface SqliteClient<TSchema extends Record<string, unknown>> {
	db: Db<TSchema>;
	close: () => Promise<void>;
}

export async function createSqliteDatabase<
	TSchema extends Record<string, unknown>,
>(
	schema: TSchema,
	options: SqliteClientOptions,
): Promise<SqliteClient<TSchema>> {
	const { default: Database } = await import("better-sqlite3");
	const { drizzle } = await import("drizzle-orm/better-sqlite3");

	const sqlite = new Database(options.filename);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("foreign_keys = ON");

	const db: Db<TSchema> = drizzle(sqlite, { schema });

	return {
		db,
		close: async () => {
			sqlite.close();
		},
	};
}
