import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./schema/auth-schema.js";

export interface AuthConfig {
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
export const createAuth = (config: AuthConfig) => {
	const pool = new pg.Pool({ connectionString: config.connectionString });
	const db = drizzle(pool, { schema: authSchema });

	return betterAuth({
		secret: config.secret,
		baseURL: config.baseURL,
		trustedOrigins: config.trustedOrigins,
		database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
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

export type Auth = ReturnType<typeof createAuth>;
