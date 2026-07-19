import assert from "node:assert";
import { describe, test } from "node:test";

type AmplifyAuthMocks = {
	session: unknown;
	fetchCalls: number;
	fetchImpl: null | (() => unknown);
};
type AmplifyConfigMocks = {
	configured: boolean;
	configureCalls: number;
};

declare global {
	// eslint-disable-next-line no-var
	var __AMPLIFY_AUTH_MOCKS__: AmplifyAuthMocks | undefined;
	// eslint-disable-next-line no-var
	var __AMPLIFY_CONFIG_MOCKS__: AmplifyConfigMocks | undefined;
}

let cacheBust = 2000;

const FAR_FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

const idToken = (value: string, exp: number = FAR_FUTURE_EXP) => ({
	toString: () => value,
	payload: { exp },
});

const loadAuthToken = async (
	configured: boolean,
	authMocks: Partial<AmplifyAuthMocks>,
) => {
	cacheBust += 1;
	globalThis.__REMIT_CONFIG__ = {};
	globalThis.__AMPLIFY_CONFIG_MOCKS__ = {
		configured,
		configureCalls: 0,
	};
	globalThis.__AMPLIFY_AUTH_MOCKS__ = {
		session: { tokens: {} },
		fetchCalls: 0,
		fetchImpl: null,
		...authMocks,
	};
	return import(`./auth-token.ts?v=${cacheBust}`);
};

describe("fetchAuthToken", () => {
	test("returns the Cognito id token when configured", async () => {
		const mod = await loadAuthToken(true, {
			session: { tokens: { idToken: idToken("ID-TOKEN-123") } },
		});
		assert.equal(await mod.fetchAuthToken(), "ID-TOKEN-123");
	});

	test("returns null when the session has no idToken", async () => {
		const mod = await loadAuthToken(true, { session: { tokens: {} } });
		assert.equal(await mod.fetchAuthToken(), null);
	});

	test("returns null when the tokens field is absent", async () => {
		const mod = await loadAuthToken(true, { session: {} });
		assert.equal(await mod.fetchAuthToken(), null);
	});

	test("returns null when cognito is not configured", async () => {
		const mod = await loadAuthToken(false, {
			session: { tokens: { idToken: idToken("UNUSED") } },
		});
		assert.equal(await mod.fetchAuthToken(), null);
		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 0);
	});

	test("propagates errors when fetchAuthSession rejects (let it crash)", async () => {
		const mod = await loadAuthToken(true, {
			fetchImpl: () => {
				throw new Error("session fetch failed");
			},
		});
		await assert.rejects(() => mod.fetchAuthToken(), /session fetch failed/);
	});

	test("reuses the cached token across calls without re-fetching the session", async () => {
		const mod = await loadAuthToken(true, {
			session: { tokens: { idToken: idToken("CACHED") } },
		});
		assert.equal(await mod.fetchAuthToken(), "CACHED");
		assert.equal(await mod.fetchAuthToken(), "CACHED");
		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 1);
	});

	test("re-fetches the session when the cached token is near expiry", async () => {
		const almostExpired = Math.floor(Date.now() / 1000) + 5;
		const mod = await loadAuthToken(true, {
			session: { tokens: { idToken: idToken("STALE", almostExpired) } },
		});
		await mod.fetchAuthToken();
		await mod.fetchAuthToken();
		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 2);
	});

	test("resetAuthTokenCache forces the next call to re-fetch the session", async () => {
		const mod = await loadAuthToken(true, {
			session: { tokens: { idToken: idToken("CACHED") } },
		});
		await mod.fetchAuthToken();
		mod.resetAuthTokenCache();
		await mod.fetchAuthToken();
		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 2);
	});
});
