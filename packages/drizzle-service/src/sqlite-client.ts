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
// The opener is imported dynamically so the SQLite driver stays out of
// everything that imports this package's index.

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
	const { openSqlite } = await import("./sqlite.js");

	const handle = openSqlite({
		filename: options.filename,
		mode: "create",
		synchronous: "NORMAL",
		schema,
	});

	return {
		db: handle.db,
		close: async () => {
			handle.close();
		},
	};
}
