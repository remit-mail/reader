import { access, constants } from "node:fs/promises";
import { isSelfHostSqlBackend } from "../src/data-backend.js";

// better-auth holds its own connection to this same file for the process
// lifetime (RFC 036 D3, one file), and SQLite's unix VFS shares one already-
// validated file handle across same-process connections to the same inode —
// so a *new* connection here can keep succeeding after the path stops being
// reachable (permissions revoked, volume gone read-only). `access` is a fresh
// syscall with no such sharing, so it is what actually re-checks reachability
// on every call; the query after it still exercises the SQL engine itself.
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
