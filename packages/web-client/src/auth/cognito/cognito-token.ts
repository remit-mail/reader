import { fetchAuthSession } from "aws-amplify/auth";
import { isCognitoConfigured } from "../amplify-config";

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

/**
 * The Cognito bearer token: the Amplify session's ID token, cached until it
 * nears expiry. Returns `null` when Cognito is not configured (local dev), so
 * the request simply carries no token. This is the `getToken` behind the
 * Cognito auth provider — the `aws-amplify/auth` dependency lives here, never in
 * the shell or a screen.
 */
export const getCognitoToken = async (): Promise<string | null> => {
	if (!isCognitoConfigured()) return null;
	if (isUsable(cached)) return cached.value;
	return refreshCognitoToken();
};

export const resetCognitoTokenCache = (): void => {
	cached = null;
};
