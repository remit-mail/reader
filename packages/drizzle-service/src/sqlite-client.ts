import type { Db } from "./db.js";
import { serializeSqliteWrites } from "./tx.js";

// The one place a SQLite connection is opened for the app (RFC 036 D3). Every
// writer container (backend, imap-worker, smtp-worker, account-worker) opens the
// same file here with the same cross-process settings — WAL for concurrent
// readers, a 5 s busy_timeout so a writer waits out another's short transaction
// instead of failing, synchronous=NORMAL (durable under WAL), foreign keys on.
//
// The handle is wrapped by `serializeSqliteWrites` before it leaves this
// function, so a repo's insert/update/delete cannot bypass the in-process write
// serialization (RFC 036 D3). `run`/`transaction`/reads pass through by design —
// see the wrapper's comment.
//
// better-sqlite3 and its drizzle driver are imported dynamically so the Postgres
// path never loads the native binding, and so the whole module stays out of the
// DynamoDB Lambda bundle (this package is `external` there — see
// remit-backend/src/service/dynamodb.ts).

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

	const base = drizzle(sqlite, { schema }) as unknown as Db<TSchema>;

	return {
		db: serializeSqliteWrites(base),
		close: async () => {
			sqlite.close();
		},
	};
}
