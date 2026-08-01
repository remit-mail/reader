import type { Auth as BetterAuthInstance } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import * as authSchemaSqlite from "./schema/auth-schema-sqlite.js";

export interface AuthConfig {
	/**
	 * Path to the shared database file (RFC 036 D3). The identity tables live
	 * beside the app tables and are driven through the drizzle adapter's
	 * `sqlite` provider.
	 */
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

// The drizzle adapter better-auth runs against. better-sqlite3 and its drizzle
// driver are imported dynamically so the module stays out of any bundle that
// never opens the database. The auth connection sets the same WAL/busy_timeout
// coordination every writer uses (RFC 036 D3) — it shares the file with the app
// tables through its own connection.
const buildAuthAdapter = async (config: AuthConfig) => {
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
};

/**
 * The header carrying the client address, set by the edge proxy from the
 * connection it terminates (deploy/vps/caddy/routes.caddy). It is deliberately
 * not `X-Forwarded-For`: that header arrives with an appended hop per proxy,
 * which resolves to no single client and collapses rate limiting onto one
 * shared bucket for everybody. Nothing else in the chain writes this name, and
 * the edge replaces any value a client sends, so it is single-valued and
 * trustworthy at the point better-auth reads it.
 */
export const CLIENT_IP_HEADER = "x-remit-client-ip";

const intEnv = (name: string, fallback: number): number => {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Build a better-auth instance bound to the self-host database file.
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
		// Listing one header, and not better-auth's `x-forwarded-for` default,
		// is what keeps the resolved address out of a caller's reach: an
		// `X-Forwarded-For` a client sends is never read at all.
		advanced: {
			ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
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
