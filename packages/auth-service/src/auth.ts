import { openSqlite } from "@remit/drizzle-service/sqlite";
import { logger } from "@remit/logger";
import type { Auth as BetterAuthInstance } from "better-auth";
import { betterAuth, type GenericEndpointContext } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import {
	ACCOUNT_DISABLED,
	CLIENT_IP_HEADER,
	SIGN_IN_DISABLED,
} from "./constants.js";
import {
	deleteSessions,
	type IdentityStore,
	isUserDisabled,
	markSignedIn,
	sessionUserOf,
} from "./identity-store.js";
import * as authSchemaSqlite from "./schema/auth-schema-sqlite.js";
export interface AuthConfig {
	/**
	 * Path to the app database file (#1420). The identity tables live beside
	 * the app tables and are driven through the drizzle adapter's `sqlite`
	 * provider.
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
	signInEnabled: boolean;
}

// The drizzle adapter better-auth runs against. The auth connection sets the
// same WAL/busy_timeout coordination every writer uses (RFC 036 D3) — it
// shares the file with the app tables through its own connection.
const buildAuthAdapter = (config: AuthConfig) => {
	const { db } = openSqlite({
		filename: config.connectionString,
		mode: "create",
	});
	return drizzleAdapter(db, {
		provider: "sqlite",
		schema: authSchemaSqlite,
	});
};

export {
	ACCOUNT_DISABLED,
	CLIENT_IP_HEADER,
	SIGN_IN_DISABLED,
} from "./constants.js";

const RESET_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const MIN_PASSWORD_LENGTH = 12;

const MAX_PASSWORD_LENGTH = 128;

const UNKNOWN = "unknown";

const clientIpOf = (ctx: GenericEndpointContext | null): string =>
	ctx?.request?.headers.get(CLIENT_IP_HEADER) ??
	ctx?.headers?.get(CLIENT_IP_HEADER) ??
	UNKNOWN;

const SESSION_PATHS: ReadonlySet<string> = new Set(["/token", "/get-session"]);

/**
 * The kill switch, then the disabled check on the two paths that carry a
 * session forward. A sign-in that commits its session just after a disable
 * would otherwise keep minting tokens; here that user's sessions go and the
 * mint is refused.
 */
const gate = (store: IdentityStore, signInEnabled: boolean) =>
	createAuthMiddleware(async (ctx) => {
		if (!signInEnabled && ctx.path !== "/jwks") {
			throw new APIError("FORBIDDEN", { ...SIGN_IN_DISABLED });
		}
		if (!SESSION_PATHS.has(ctx.path)) return;
		const sessionToken = await ctx.getSignedCookie(
			ctx.context.authCookies.sessionToken.name,
			ctx.context.secret,
		);
		if (!sessionToken) return;
		const user = sessionUserOf(store, sessionToken);
		if (!user?.disabled) return;
		store.immediate(() => {
			deleteSessions(store, user.userId);
			store.audit({
				actor: user.userId,
				target: user.userId,
				action: "SignInRefusedDisabled",
				outcome: "RefusedDisabled",
				clientIp: clientIpOf(ctx),
			});
		});
		throw new APIError("FORBIDDEN", { ...ACCOUNT_DISABLED });
	});

/**
 * Every redeem of a reset link leaves a log line carrying its Origin, and a
 * refused one an audit record. A refused token names no user.
 */
const resetAudit = (store: IdentityStore) =>
	createAuthMiddleware(async (ctx) => {
		if (ctx.path !== "/reset-password") return;
		const refused = isAPIError(ctx.context.returned);
		// biome-ignore lint/plugin/no-logger-info: a reset redeem is an audit-grade signal
		logger.info(
			{
				origin: ctx.request?.headers.get("origin") ?? null,
				clientIp: clientIpOf(ctx),
				accepted: !refused,
			},
			"Password reset redeem",
		);
		if (!refused) return;
		store.immediate(() =>
			store.audit({
				actor: UNKNOWN,
				target: UNKNOWN,
				action: "PasswordResetRefused",
				outcome: "RefusedToken",
				clientIp: clientIpOf(ctx),
			}),
		);
	});

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
	store: IdentityStore,
): Promise<BetterAuthInstance> => {
	const database = buildAuthAdapter(config);

	return betterAuth({
		secret: config.secret,
		baseURL: config.baseURL,
		trustedOrigins: config.trustedOrigins,
		database,
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			disableSignUp: !config.selfSignUpEnabled,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			maxPasswordLength: MAX_PASSWORD_LENGTH,
			resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
			revokeSessionsOnPasswordReset: true,
			onPasswordReset: async ({ user }, request) => {
				store.immediate(() =>
					store.audit({
						actor: user.id,
						target: user.id,
						action: "PasswordResetRedeemed",
						outcome: "Succeeded",
						clientIp: request?.headers.get(CLIENT_IP_HEADER) ?? UNKNOWN,
					}),
				);
			},
		},
		hooks: {
			before: gate(store, config.signInEnabled),
			after: resetAudit(store),
		},
		databaseHooks: {
			session: {
				create: {
					before: async (session, ctx) => {
						if (!isUserDisabled(store.db, session.userId)) return;
						store.immediate(() =>
							store.audit({
								actor: session.userId,
								target: session.userId,
								action: "SignInRefusedDisabled",
								outcome: "RefusedDisabled",
								clientIp: clientIpOf(ctx),
							}),
						);
						throw new APIError("FORBIDDEN", { ...ACCOUNT_DISABLED });
					},
					after: async (session) => {
						markSignedIn(store, session.userId);
					},
				},
			},
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
		user: {
			modelName: "auth_user",
			additionalFields: {
				disabled: {
					type: "boolean",
					required: false,
					defaultValue: false,
					input: false,
					returned: false,
				},
			},
		},
		session: { modelName: "auth_session" },
		account: { modelName: "auth_account" },
		verification: {
			modelName: "auth_verification",
			storeIdentifier: {
				default: "plain",
				overrides: { "reset-password": "hashed" },
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
