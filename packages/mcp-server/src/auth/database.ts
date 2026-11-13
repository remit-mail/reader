import { auth_account, auth_user } from "@remit/auth-service/schema";
import {
	type Db,
	openSqlite,
	type SqliteHandle,
} from "@remit/drizzle-service/sqlite";

export type McpAuthDb = Db;

const SHARED_TABLES: ReadonlySet<unknown> = new Set([auth_user, auth_account]);
const WRITES: ReadonlySet<PropertyKey> = new Set([
	"insert",
	"update",
	"delete",
]);

export const refuseSharedTableWrites = (db: McpAuthDb): McpAuthDb =>
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

export const openMcpAuthDatabase = (filename: string): SqliteHandle =>
	openSqlite({ filename, mode: "create" });
