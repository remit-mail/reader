import { createAuthClient } from "better-auth/react";
import { taggedFetch } from "../lib/network-error";
import { getRuntimeConfig } from "../runtime-config";

/**
 * better-auth owns identity in the Postgres-parity / local mode. It is gated
 * behind an explicit flag so the Cognito path and the existing no-auth e2e
 * bypass are untouched unless a deployment opts in.
 */
export const isBetterAuthEnabled = (): boolean =>
	getRuntimeConfig().betterAuthEnabled;

/**
 * Error code better-auth returns from `/sign-up/email` when signup is closed
 * server-side (`disableSignUp`, driven by `SELF_SIGN_UP_ENABLED`). The client
 * uses it as the single source of truth for the closed state, so the UI can
 * never drift from the server.
 */
export const SIGN_UP_DISABLED_CODE = "EMAIL_PASSWORD_SIGN_UP_DISABLED";

export const isSignUpDisabledError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { code?: unknown }).code === SIGN_UP_DISABLED_CODE;

// Same-origin: the client calls `/api/auth/*`, which the dev proxy forwards to
// the backend's mounted better-auth handler.
export const authClient = createAuthClient();

const EXPIRY_SKEW_SECONDS = 60;

interface CachedToken {
	value: string;
	expiresAt: number;
}

let cached: CachedToken | null = null;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const decodeExp = (token: string): number => {
	const [, payload] = token.split(".");
	if (!payload) return nowSeconds();
	try {
		const json = JSON.parse(
			atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
		);
		return typeof json.exp === "number" ? json.exp : nowSeconds();
	} catch {
		return nowSeconds();
	}
};

/**
 * A session exists but no bearer token could be produced for it. Distinct from
 * "signed out": there is nothing to fall back to, so the request that needed the
 * token must not be sent. Carries the mint's HTTP status where there was one, so
 * the shared classifier reads it like any other API failure.
 */
export class AuthTokenError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "AuthTokenError";
		this.status = status;
	}
}

const requestToken = async (): Promise<string> => {
	const res = await taggedFetch("/api/auth/token", {
		credentials: "include",
	});
	if (!res.ok) {
		throw new AuthTokenError(
			`Could not mint a session token: ${res.status} ${res.statusText}`,
			res.status,
		);
	}
	const body: unknown = await res.json();
	if (
		body &&
		typeof body === "object" &&
		"token" in body &&
		typeof (body as { token: unknown }).token === "string"
	) {
		return (body as { token: string }).token;
	}
	throw new AuthTokenError("The token endpoint returned no token");
};

let inFlight: Promise<string> | null = null;

/**
 * One mint at a time. A cold load renders many screens at once and each of their
 * requests needs the same token; without this every one of them mints its own,
 * and the burst is large enough to spend the auth tier's rate-limit budget. The
 * slot is released once the mint settles, so a failure is not replayed to later
 * callers — they mint again.
 */
const mint = (): Promise<string> => {
	if (inFlight) return inFlight;
	inFlight = requestToken()
		.then((token) => {
			cached = { value: token, expiresAt: decodeExp(token) };
			return token;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
};

/**
 * Return a valid RS256 JWT for the current session, minting a fresh one only
 * when the cached token is missing or within the skew window of expiry. The API
 * interceptor attaches it as a Bearer token; the backend verifies it against the
 * JWKS.
 *
 * Never resolves to null: a failed mint throws. Returning null would put the
 * request on the wire without an Authorization header, and the backend answers
 * that with a 401 that names a missing token rather than the mint that failed.
 */
export const fetchBetterAuthToken = async (): Promise<string> => {
	if (cached && cached.expiresAt - EXPIRY_SKEW_SECONDS > nowSeconds()) {
		return cached.value;
	}
	return mint();
};

export const resetBetterAuthTokenCache = (): void => {
	cached = null;
};
