import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the committed SQLite migrations of the MCP
 * authorization server's own tables. The shared better-auth user and account
 * tables are referenced, never migrated here.
 */
export default {
	dialect: "sqlite",
	schema: "packages/mcp-server/src/auth/schema.ts",
	out: "deploy/vps/migrations-sqlite/mcp",
	tablesFilter: ["mcp_*"],
} satisfies Config;
