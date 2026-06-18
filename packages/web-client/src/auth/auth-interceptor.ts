import { client } from "@remit/api-http-client/client.gen.ts";
import { fetchAuthSession } from "aws-amplify/auth";
import { isCognitoConfigured } from "./amplify-config";

let installed = false;

const EXPIRY_SKEW_SECONDS = 60;

interface CachedToken {
	value: string;
	expiresAt: number;
}

let cached: CachedToken | null = null;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const isUsable = (token: CachedToken | null): token is CachedToken =>
	token !== null && token.expiresAt - EXPIRY_SKEW_SECONDS > nowSeconds();

const refreshToken = async (): Promise<CachedToken | null> => {
	const session = await fetchAuthSession();
	const idToken = session.tokens?.idToken;
	if (!idToken) {
		cached = null;
		return null;
	}
	const value = idToken.toString();
	const exp = idToken.payload.exp;
	cached = {
		value,
		expiresAt: exp ?? nowSeconds() + EXPIRY_SKEW_SECONDS,
	};
	return cached;
};

const getIdToken = async (): Promise<string | null> => {
	if (isUsable(cached)) return cached.value;
	const token = await refreshToken();
	return token?.value ?? null;
};

export const resetTokenCache = (): void => {
	cached = null;
};

export const installAuthInterceptor = (): void => {
	if (installed) return;
	if (!isCognitoConfigured()) return;

	client.interceptors.request.use(async (request) => {
		const token = await getIdToken();
		if (token) {
			request.headers.set("Authorization", `Bearer ${token}`);
		}
		return request;
	});

	installed = true;
};
