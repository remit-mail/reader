import { fetchAuthSession } from "aws-amplify/auth";
import { isCognitoConfigured } from "./amplify-config";
import {
	fetchBetterAuthToken,
	isBetterAuthEnabled,
} from "./better-auth-config";

const EXPIRY_SKEW_SECONDS = 60;

interface CachedToken {
	value: string;
	expiresAt: number;
}

let cached: CachedToken | null = null;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const isUsable = (token: CachedToken | null): token is CachedToken =>
	token !== null && token.expiresAt - EXPIRY_SKEW_SECONDS > nowSeconds();

const refreshCognitoToken = async (): Promise<string | null> => {
	const session = await fetchAuthSession();
	const idToken = session.tokens?.idToken;
	if (!idToken) {
		cached = null;
		return null;
	}
	cached = {
		value: idToken.toString(),
		expiresAt: idToken.payload.exp ?? nowSeconds() + EXPIRY_SKEW_SECONDS,
	};
	return cached.value;
};

const fetchCognitoToken = async (): Promise<string | null> => {
	if (isUsable(cached)) return cached.value;
	return refreshCognitoToken();
};

/**
 * Single seam for the current session's bearer token, mirroring the
 * `VITE_BETTER_AUTH_ENABLED` branch in `AuthShell`. better-auth mints its own
 * RS256 JWT; Cognito reads the Amplify session's ID token. Confining every
 * token read here keeps the Cognito (`aws-amplify/auth`) dependency inside the
 * auth modules — the API interceptor and the content-fetch hook go through
 * this function instead of reaching into Amplify directly.
 */
export const fetchAuthToken = async (): Promise<string | null> => {
	if (isBetterAuthEnabled()) return fetchBetterAuthToken();
	if (!isCognitoConfigured()) return null;
	return fetchCognitoToken();
};

export const resetAuthTokenCache = (): void => {
	cached = null;
};
