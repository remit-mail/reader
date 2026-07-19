import type { Auth as BetterAuthInstance } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * Schema-generation-only config for `@better-auth/cli generate`. It mirrors the
 * plugin set of the real `createAuth` so the emitted Drizzle schema matches what
 * runtime expects, but omits the schema import to break the generate-time
 * chicken-and-egg (the schema file is this command's output).
 */
const pool = new pg.Pool({
	connectionString:
		process.env.PG_CONNECTION_URL ??
		"postgresql://remit:remit@localhost:5432/remit_dev",
});

export const auth = betterAuth({
	secret: "schema-generation-only",
	baseURL: "http://localhost",
	database: drizzleAdapter(drizzle(pool), { provider: "pg" }),
	emailAndPassword: { enabled: true },
	user: { modelName: "auth_user" },
	session: { modelName: "auth_session" },
	account: { modelName: "auth_account" },
	verification: { modelName: "auth_verification" },
	plugins: [
		jwt({
			schema: { jwks: { modelName: "auth_jwks" } },
			jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
		}),
	],
}) as unknown as BetterAuthInstance;
