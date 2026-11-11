import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the committed SQLite migrations of the MCP
 * authorization server's own tables, applied to the app database beside the
 * better-auth tables they reference (#1420). The shared user and account
 * tables are referenced, never migrated here.
 */
export default {
	dialect: "sqlite",
	schema: ["packages/drizzle-service/src/schema-sets/mcp.ts"],
	out: "deploy/vps/migrations-sqlite/mcp",
	tablesFilter: ["mcp_*"],
} satisfies Config;
