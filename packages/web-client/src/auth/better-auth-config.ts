import { createAuthClient } from "better-auth/react";
import { NetworkError, taggedFetch } from "../lib/network-error";
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

// How long to stop reaching for the token endpoint after a mint is throttled.
// A near-expiry token is still usable for `EXPIRY_SKEW_SECONDS`, so backing off
// keeps a throttled window from turning every request into another mint attempt
// against an endpoint that already said no.
const REFRESH_BACKOFF_SECONDS = 30;

// Survives page reloads and in-tab navigations so a fresh page load reuses the
// session's token instead of minting a new one. Cleared on sign-out. Scoped to
// the tab, not the origin: the token is short-lived and the httpOnly session
// cookie remains the real credential.
const STORAGE_KEY = "remit.better-auth.token";

interface CachedToken {
	value: string;
	expiresAt: number;
}

const tokenStore = (): Storage | null => {
	try {
		return globalThis.sessionStorage ?? null;
	} catch {
		return null;
	}
};

const readStore = (): CachedToken | null => {
	const raw = tokenStore()?.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof (parsed as CachedToken).value === "string" &&
			typeof (parsed as CachedToken).expiresAt === "number"
		) {
			return {
				value: (parsed as CachedToken).value,
				expiresAt: (parsed as CachedToken).expiresAt,
			};
		}
	} catch {
		// A corrupt entry is treated as no token.
	}
	return null;
};

const writeStore = (token: CachedToken | null): void => {
	const store = tokenStore();
	if (!store) return;
	try {
		if (!token) {
			store.removeItem(STORAGE_KEY);
			return;
		}
		store.setItem(STORAGE_KEY, JSON.stringify(token));
	} catch {
		// Storage being unavailable (private mode, quota) is not fatal: the
		// in-memory cache still serves the current page.
	}
};

let cached: CachedToken | null = null;
let backoffUntil = 0;

// Hydrate the in-memory cache from storage on first read of a page load, so a
// token minted before a reload is reused rather than re-minted.
const currentCache = (): CachedToken | null => {
	if (cached) return cached;
	cached = readStore();
	return cached;
};

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
			writeStore(cached);
			backoffUntil = 0;
			return token;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
};

const isFresh = (token: CachedToken): boolean =>
	token.expiresAt - EXPIRY_SKEW_SECONDS > nowSeconds();

const isUsable = (token: CachedToken): boolean =>
	token.expiresAt > nowSeconds();

/**
 * A mint failure the held token is allowed to ride out: a request timeout (408),
 * throttling (429), a server-side fault (5xx), or a transport failure that never
 * reached the server. These say nothing about the session's validity, so keeping
 * the token the tab already holds is correct. A 4xx that is not 408 or 429 does
 * not qualify — least of all a 401/403, which is the server revoking the session.
 */
const isTransientMintFailure = (error: unknown): boolean => {
	if (error instanceof NetworkError) return true;
	if (error instanceof AuthTokenError) {
		return (
			error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500
		);
	}
	return false;
};

/**
 * The mint was refused because the session is no longer valid. The held token is
 * signed for that same revoked session, so it must be discarded rather than
 * served until it expires.
 */
const isRevocation = (error: unknown): boolean =>
	error instanceof AuthTokenError &&
	(error.status === 401 || error.status === 403);

/**
 * Return a valid RS256 JWT for the current session, minting a fresh one only
 * when the cached token is missing or within the skew window of expiry. The API
 * interceptor attaches it as a Bearer token; the backend verifies it against the
 * JWKS.
 *
 * A throttled, faulted, or unreachable refresh never discards a token that is
 * still usable: the request keeps the session it already holds and the endpoint
 * is left alone until the backoff clears. A revocation (401/403) is the opposite
 * — the session behind the held token is gone, so it is cleared and the failure
 * propagates to re-authentication rather than serving a dead token until expiry.
 * Only a mint with nothing usable to fall back to throws otherwise — returning
 * null would put the request on the wire without an Authorization header, and the
 * backend answers that with a 401 that names a missing token rather than the mint
 * that failed.
 */
export const fetchBetterAuthToken = async (): Promise<string> => {
	const current = currentCache();

	if (current && isFresh(current)) {
		return current.value;
	}

	if (current && isUsable(current) && nowSeconds() < backoffUntil) {
		return current.value;
	}

	try {
		return await mint();
	} catch (error) {
		if (isRevocation(error)) {
			resetBetterAuthTokenCache();
			throw error;
		}
		if (current && isUsable(current) && isTransientMintFailure(error)) {
			backoffUntil = nowSeconds() + REFRESH_BACKOFF_SECONDS;
			return current.value;
		}
		throw error;
	}
};

export const resetBetterAuthTokenCache = (): void => {
	backoffUntil = 0;
	writeStore(null);
	cached = null;
};
