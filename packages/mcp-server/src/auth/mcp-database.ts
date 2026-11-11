import * as mcpTables from "@remit/drizzle-service/schema-sets/mcp";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BaseSQLiteDatabase, SQLiteTable } from "drizzle-orm/sqlite-core";

export interface McpUserTables {
	user: SQLiteTable;
	account: SQLiteTable;
}

export type McpSqliteDatabase = BaseSQLiteDatabase<
	"async" | "sync",
	unknown,
	Record<string, unknown>
>;

export const mcpDatabase = (
	db: McpSqliteDatabase,
	tables: McpUserTables,
): BetterAuthOptions["database"] =>
	drizzleAdapter(db, {
		provider: "sqlite",
		schema: { ...mcpTables, user: tables.user, account: tables.account },
	});
