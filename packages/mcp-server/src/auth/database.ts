import { auth_account, auth_user } from "@remit/auth-service/schema";
import Database from "better-sqlite3";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";

export interface McpAuthDatabase {
	db: BetterSQLite3Database;
	close: () => void;
}

const SHARED_TABLES: ReadonlySet<unknown> = new Set([auth_user, auth_account]);
const WRITES: ReadonlySet<PropertyKey> = new Set([
	"insert",
	"update",
	"delete",
]);

export const refuseSharedTableWrites = (
	db: BetterSQLite3Database,
): BetterSQLite3Database =>
	new Proxy(db, {
		get(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver);
			if (!WRITES.has(property) || typeof value !== "function") return value;
			return (table: unknown) => {
				if (SHARED_TABLES.has(table)) {
					throw new Error(
						"The MCP server never writes the shared auth_user or auth_account tables",
					);
				}
				return value.call(target, table);
			};
		},
	});

export const openMcpAuthDatabase = (filename: string): McpAuthDatabase => {
	const sqlite = new Database(filename);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("foreign_keys = ON");
	return {
		db: refuseSharedTableWrites(drizzle(sqlite)),
		close: () => sqlite.close(),
	};
};
