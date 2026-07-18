import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./schema/auth-schema.js";
import * as authSchemaSqlite from "./schema/auth-schema-sqlite.js";

export interface AuthConfig {
	/**
	 * The relational backend better-auth runs on, off `DATA_BACKEND` (RFC 036).
	 * `pg` (the default) reads `connectionString` as a Postgres URL; `sqlite`
	 * reads it as the path to the shared database file (D3), and drives the
	 * SQLite identity schema through the drizzle adapter's `sqlite` provider.
	 */
	provider?: "pg" | "sqlite";
	connectionString: string;
	secret: string;
	baseURL: string;
	trustedOrigins?: string[];
	/**
	 * Self-service signup switch, mirroring the Cognito user pool's
	 * `selfSignUpEnabled`. `false` closes signup via better-auth's
	 * `disableSignUp`; accounts are then provisioned out-of-band.
	 */
	selfSignUpEnabled: boolean;
}

// The drizzle adapter better-auth runs against, chosen by backend. better-sqlite3
// and its drizzle driver are imported dynamically so the Postgres path never
// loads the native binding, and the module stays out of any bundle that never
// runs on SQLite. On SQLite the auth connection sets the same WAL/busy_timeout
// coordination every writer uses (RFC 036 D3) — it shares the file with the app
// tables through its own connection.
const buildAuthAdapter = async (config: AuthConfig) => {
	if (config.provider === "sqlite") {
		const { default: Database } = await import("better-sqlite3");
		const { drizzle } = await import("drizzle-orm/better-sqlite3");
		const sqlite = new Database(config.connectionString);
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("busy_timeout = 5000");
		sqlite.pragma("synchronous = NORMAL");
		sqlite.pragma("foreign_keys = ON");
		return drizzleAdapter(drizzle(sqlite, { schema: authSchemaSqlite }), {
			provider: "sqlite",
			schema: authSchemaSqlite,
		});
	}

	const pool = new pg.Pool({ connectionString: config.connectionString });
	return drizzleAdapter(drizzlePg(pool, { schema: authSchema }), {
		provider: "pg",
		schema: authSchema,
	});
};

const intEnv = (name: string, fallback: number): number => {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Build a better-auth instance bound to the pg-parity Postgres.
 *
 * RS256 is deliberate: the edge tier (APISIX, or the dev-server verifier)
 * follows JWKS key rotation offline, so signing must be asymmetric. The JWKS is
 * published at `${baseURL}/api/auth/jwks` and tokens are minted at
 * `${baseURL}/api/auth/token`.
 */
export const createAuth = async (config: AuthConfig) => {
	const database = await buildAuthAdapter(config);

	return betterAuth({
		secret: config.secret,
		baseURL: config.baseURL,
		trustedOrigins: config.trustedOrigins,
		database,
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			disableSignUp: !config.selfSignUpEnabled,
		},
		rateLimit: {
			enabled: true,
			window: intEnv("BETTER_AUTH_RATE_LIMIT_WINDOW", 60),
			max: intEnv("BETTER_AUTH_RATE_LIMIT_MAX", 100),
			customRules: {
				"/sign-in/email": {
					window: intEnv("BETTER_AUTH_RATE_LIMIT_SIGN_IN_WINDOW", 60),
					max: intEnv("BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX", 5),
				},
				"/sign-up/email": {
					window: intEnv("BETTER_AUTH_RATE_LIMIT_SIGN_UP_WINDOW", 60),
					max: intEnv("BETTER_AUTH_RATE_LIMIT_SIGN_UP_MAX", 5),
				},
			},
		},
		user: { modelName: "auth_user" },
		session: { modelName: "auth_session" },
		account: { modelName: "auth_account" },
		verification: { modelName: "auth_verification" },
		plugins: [
			jwt({
				schema: { jwks: { modelName: "auth_jwks" } },
				jwt: {
					issuer: config.baseURL,
					audience: config.baseURL,
					expirationTime: "15m",
				},
				jwks: {
					keyPairConfig: { alg: "RS256", modulusLength: 2048 },
				},
			}),
		],
	});
};

export type Auth = Awaited<ReturnType<typeof createAuth>>;
