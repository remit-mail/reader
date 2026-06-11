import {
	classifyMicrosoftError,
	type MicrosoftTokenErrorResponse,
} from "./microsoft-errors.js";
import {
	type OAuthProviderConfig,
	RefreshTokenError,
	type TokenSet,
} from "./types.js";

export interface MailOAuthService {
	/** Exchange an authorization code for a token set. */
	exchangeCode(
		code: string,
		redirectUri: string,
		codeVerifier?: string,
	): Promise<TokenSet>;

	/** Refresh an access token using a refresh token. Throws RefreshTokenError on failure. */
	refresh(refreshToken: string): Promise<TokenSet>;

	/** Build the OAuth2 authorization URL to redirect the user to. */
	buildAuthorizationUrl(opts: {
		redirectUri: string;
		state: string;
		loginHint?: string;
	}): string;

	/**
	 * Return a valid access token for the given cache key, refreshing if needed.
	 * Concurrent callers for the same key share a single in-flight refresh (single-flight).
	 *
	 * Rotation contract: if the provider rotates the refresh token, the new value is
	 * surfaced in the returned `TokenSet.refreshToken`. The caller is responsible for
	 * persisting it — this service never persists tokens.
	 */
	getAccessToken(cacheKey: string, refreshToken: string): Promise<TokenSet>;
}

/** Tokens are refreshed 5 minutes before expiry. */
const EXPIRY_BUFFER_SECS = 5 * 60;

interface CacheEntry {
	tokenSet?: TokenSet;
	promise?: Promise<TokenSet>;
}

interface RawTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	error?: string;
	error_codes?: number[];
	error_description?: string;
}

function parseTokenResponse(
	httpStatus: number,
	raw: RawTokenResponse,
): TokenSet {
	if (raw.error) {
		const classified = classifyMicrosoftError(
			httpStatus,
			raw as MicrosoftTokenErrorResponse,
		);
		throw new RefreshTokenError(classified);
	}

	return {
		accessToken: raw.access_token,
		expiresAt: Math.floor(Date.now() / 1000) + raw.expires_in,
		...(raw.refresh_token ? { refreshToken: raw.refresh_token } : {}),
	};
}

async function postForm(
	url: string,
	params: Record<string, string>,
): Promise<TokenSet> {
	const body = new URLSearchParams(params).toString();

	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
	} catch (cause) {
		// network error → transient
		throw new RefreshTokenError({ kind: "transient", code: "network_error" });
	}

	let raw: RawTokenResponse;
	try {
		raw = (await response.json()) as RawTokenResponse;
	} catch {
		throw new RefreshTokenError({
			kind: "transient",
			code: "invalid_response",
		});
	}

	if (!response.ok && !raw.error) {
		// Non-OK HTTP with no error body → treat as transient
		throw new RefreshTokenError({
			kind: "transient",
			code: `http_${response.status}`,
		});
	}

	return parseTokenResponse(response.status, raw);
}

function isExpiringSoon(tokenSet: TokenSet): boolean {
	const nowSecs = Math.floor(Date.now() / 1000);
	return tokenSet.expiresAt - nowSecs < EXPIRY_BUFFER_SECS;
}

export function createMailOAuthService(
	config: OAuthProviderConfig,
): MailOAuthService {
	const cache = new Map<string, CacheEntry>();

	return {
		buildAuthorizationUrl({ redirectUri, state, loginHint }) {
			const url = new URL(config.authorizationEndpoint);
			url.searchParams.set("client_id", config.clientId);
			url.searchParams.set("response_type", "code");
			url.searchParams.set("scope", config.scopes.join(" "));
			url.searchParams.set("redirect_uri", redirectUri);
			url.searchParams.set("state", state);
			url.searchParams.set("access_type", "offline"); // Google compat
			url.searchParams.set("prompt", "consent"); // reliably get refresh token
			if (loginHint) {
				url.searchParams.set("login_hint", loginHint);
			}
			return url.toString();
		},

		async exchangeCode(code, redirectUri, codeVerifier) {
			const params: Record<string, string> = {
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: config.clientId,
				client_secret: config.clientSecret,
			};
			if (codeVerifier) {
				params.code_verifier = codeVerifier;
			}
			return postForm(config.tokenEndpoint, params);
		},

		async refresh(refreshToken) {
			return postForm(config.tokenEndpoint, {
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				scope: config.scopes.join(" "),
			});
		},

		async getAccessToken(cacheKey, refreshToken) {
			const entry = cache.get(cacheKey);

			// Return cached token if still valid
			if (entry?.tokenSet && !isExpiringSoon(entry.tokenSet)) {
				return entry.tokenSet;
			}

			// Single-flight: if a refresh is already in-flight for this key, await it
			if (entry?.promise) {
				return entry.promise;
			}

			// Start a new refresh
			const promise = postForm(config.tokenEndpoint, {
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: config.clientId,
				client_secret: config.clientSecret,
				scope: config.scopes.join(" "),
			}).then(
				(tokenSet) => {
					cache.set(cacheKey, { tokenSet });
					return tokenSet;
				},
				(err) => {
					// Clear the promise so next caller tries again
					const current = cache.get(cacheKey);
					if (current?.promise === promise) {
						cache.delete(cacheKey);
					}
					throw err;
				},
			);

			cache.set(cacheKey, { tokenSet: entry?.tokenSet, promise });

			return promise;
		},
	};
}
