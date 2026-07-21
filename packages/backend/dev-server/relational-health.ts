import { access, constants } from "node:fs/promises";
import { isSelfHostSqlBackend } from "../src/data-backend.js";

// The SELECT ping opens a read-only connection, so it keeps succeeding on a
// file that can still be read but no longer written — permissions revoked to
// read-only, or the volume remounted read-only under the process. The backend
// must write (better-auth persists sessions to this same file, RFC 036 D3), so
// a readable-but-unwritable store has to report unhealthy. `access(R_OK|W_OK)`
// checks both bits in one fresh syscall; the read-only query never covers
// writability. The query after it still exercises the SQL engine itself.
const pingSqlite = async (): Promise<void> => {
	const path = process.env.SQLITE_DB_PATH ?? "";
	await access(path, constants.R_OK | constants.W_OK);

	const { default: Database } = await import("better-sqlite3");
	const db = new Database(path, { readonly: true });
	try {
		db.prepare("SELECT 1").get();
	} finally {
		db.close();
	}
};

const pingPostgres = async (): Promise<void> => {
	const { Client } = await import("pg");
	const client = new Client({
		connectionString: process.env.PG_CONNECTION_URL,
		connectionTimeoutMillis: 3000,
	});
	await client.connect();
	try {
		await client.query("SELECT 1");
	} finally {
		await client.end();
	}
};

/**
 * A trivial read against whichever relational store DATA_BACKEND selects — the
 * dependency `/health` must actually exercise (RFC 037 D5, R9) so a backend that
 * booted with an unusable database reports unhealthy instead of a bare 200. The
 * AWS/DynamoDB path has no relational store and is never checked.
 */
export const checkRelationalStore = async (): Promise<boolean> => {
	if (!isSelfHostSqlBackend()) return true;

	try {
		if (process.env.DATA_BACKEND === "sqlite") {
			await pingSqlite();
		} else {
			await pingPostgres();
		}
		return true;
	} catch {
		return false;
	}
};
