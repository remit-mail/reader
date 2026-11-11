import { isUserDisabled, writeAudit } from "@remit/auth-service";
import { auth_account, auth_user } from "@remit/auth-service/schema";
import * as mcpTables from "@remit/drizzle-service/schema-sets/mcp";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
	createMcpAuth,
	type McpAuthConfig,
	type McpAuthServer,
} from "./authorization-server.js";
import { refuseSharedTableWrites } from "./database.js";
import { checkRemitPassword } from "./remit-password.js";

export const createSqliteMcpAuth = (
	config: McpAuthConfig,
	db: BetterSQLite3Database,
): McpAuthServer =>
	createMcpAuth(
		config,
		drizzleAdapter(refuseSharedTableWrites(db), {
			provider: "sqlite",
			schema: { ...mcpTables, auth_user, auth_account },
		}),
		{
			isDisabled: async (userId) => isUserDisabled(db, userId),
			audit: async (record) => writeAudit(db, record),
			browser: {
				signIn: (email, password) => checkRemitPassword(db, email, password),
			},
		},
	);
