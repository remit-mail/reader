import type { Auth as BetterAuthInstance } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createInstanceOwnerStore } from "./instance-owner.js";
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
// The return is widened to better-auth's own `Auth` type so the exported
// surface never names better-auth's bundled zod internals. When a consumer
// resolves a different zod major than better-auth (open-core reader: web-client
// pins zod 3, better-auth needs 4, so better-auth's copy nests and is
// unnameable), the inferred instance type is not portable; the widening keeps
// the public type stable across any consumer's dependency graph.
export const createAuth = async (
	config: AuthConfig,
): Promise<BetterAuthInstance> => {
	const database = await buildAuthAdapter(config);
	const instanceOwnerStore = await createInstanceOwnerStore({
		provider: config.provider === "sqlite" ? "sqlite" : "pg",
		connectionString: config.connectionString,
	});

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
				// The token endpoint is the hot path: it is polled per session, per
				// tab, and on every page load, so it needs a far higher ceiling than
				// a generic auth route. The global bucket keyed by IP otherwise
				// throttles a legitimate browser — several tabs, or a NAT'd office —
				// and a throttled mint strands the session in a 401 cascade.
				"/token": {
					window: intEnv("BETTER_AUTH_RATE_LIMIT_TOKEN_WINDOW", 60),
					max: intEnv("BETTER_AUTH_RATE_LIMIT_TOKEN_MAX", 300),
				},
			},
		},
		user: { modelName: "auth_user" },
		session: { modelName: "auth_session" },
		account: { modelName: "auth_account" },
		verification: { modelName: "auth_verification" },
		// RFC 037 D8: the instance owner is whoever registers first. Every
		// successful user creation (self-signup or OAuth) attempts the claim;
		// the singleton row's primary key is the conditional write, so only the
		// first one to land keeps it.
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await instanceOwnerStore.claimIfUnclaimed(user.id);
					},
				},
			},
		},
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
	}) as unknown as BetterAuthInstance;
};

export type Auth = Awaited<ReturnType<typeof createAuth>>;
