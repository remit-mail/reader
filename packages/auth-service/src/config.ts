import type { AuthConfig } from "./auth.js";

export const AUTH_BASE_PATH = "/api/auth";
export const AUTH_JWKS_PATH = `${AUTH_BASE_PATH}/jwks`;
export const AUTH_TOKEN_PATH = `${AUTH_BASE_PATH}/token`;

const required = (name: string, value: string | undefined): string => {
	if (!value || value.length === 0) {
		throw new Error(`Missing required auth env var: ${name}`);
	}
	return value;
};

/**
 * Whether self-service signup is open on the better-auth tier. Mirrors the
 * Cognito user pool's `selfSignUpEnabled` prop: enabled means users can
 * self-register, disabled means signup is closed and accounts are provisioned
 * out-of-band. `SELF_SIGN_UP_ENABLED` is an operator flag set in deploy config
 * (per stage). Unset defaults to enabled, preserving the current open-signup
 * behaviour; only an explicit `false`/`0`/`no` closes it. When closed,
 * `createAuth` sets better-auth's `disableSignUp`, which rejects `/sign-up/email`
 * server-side — the UI state is presentation only, not the gate.
 */
export const resolveSelfSignUpEnabled = (
	raw: string | undefined = process.env.SELF_SIGN_UP_ENABLED,
): boolean => {
	const value = (raw ?? "").trim().toLowerCase();
	return value !== "false" && value !== "0" && value !== "no";
};

export interface DataConnectionConfig {
	provider: "pg" | "sqlite";
	connectionString: string;
}

/**
 * Resolve which relational backend identity data lives on, from the same env
 * vars the rest of the self-host stack reads (RFC 036 D5). On
 * `DATA_BACKEND=sqlite` the identity tables share the app database file, so
 * the locator is `SQLITE_DB_PATH`; otherwise it is the Postgres URL.
 */
export const resolveDataConnectionConfig = (): DataConnectionConfig => {
	const provider = process.env.DATA_BACKEND === "sqlite" ? "sqlite" : "pg";
	const connectionString =
		provider === "sqlite"
			? required("SQLITE_DB_PATH", process.env.SQLITE_DB_PATH)
			: required("PG_CONNECTION_URL", process.env.PG_CONNECTION_URL);
	return { provider, connectionString };
};

/**
 * Resolve the better-auth config from the environment. Callers reach this only
 * on the self-host relational backends (Postgres or SQLite); the Cognito/AWS
 * path never touches better-auth.
 */
export const resolveAuthConfig = (): AuthConfig => {
	const baseURL = required("BETTER_AUTH_URL", process.env.BETTER_AUTH_URL);
	return {
		...resolveDataConnectionConfig(),
		secret: required("BETTER_AUTH_SECRET", process.env.BETTER_AUTH_SECRET),
		baseURL,
		trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
			.map((origin) => origin.trim())
			.filter((origin) => origin.length > 0),
		selfSignUpEnabled: resolveSelfSignUpEnabled(),
	};
};

export interface VerifierConfig {
	jwksUrl: string;
	issuer: string;
	audience: string;
}

/**
 * Derive the JWT verifier config from the same base URL the tokens are minted
 * against, so issuer/audience/JWKS all agree.
 */
export const resolveVerifierConfig = (baseURL?: string): VerifierConfig => {
	const base = required(
		"BETTER_AUTH_URL",
		baseURL ?? process.env.BETTER_AUTH_URL,
	);
	return {
		// The JWKS fetch URL can be overridden so the backend can reach its own
		// loopback mount instead of routing back through the browser-facing proxy
		// origin, while issuer/audience still match the minted token's base URL.
		jwksUrl: process.env.BETTER_AUTH_JWKS_URL ?? `${base}${AUTH_JWKS_PATH}`,
		issuer: base,
		audience: base,
	};
};
