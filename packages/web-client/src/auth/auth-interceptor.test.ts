import assert from "node:assert";
import { describe, test } from "node:test";

type RequestFn = (req: Request) => Promise<Request>;
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
	// eslint-disable-next-line no-var
	var __REMIT_CLIENT_MOCKS__: { requestFns: RequestFn[] } | undefined;
}

let cacheBust = 1000;

const FAR_FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

const idToken = (value: string, exp: number = FAR_FUTURE_EXP) => ({
	toString: () => value,
	payload: { exp },
});

const loadInterceptor = async (
	configured: boolean,
	authMocks: Partial<AmplifyAuthMocks>,
) => {
	cacheBust += 1;
	globalThis.__AMPLIFY_CONFIG_MOCKS__ = {
		configured,
		configureCalls: 0,
	};
	globalThis.__REMIT_CLIENT_MOCKS__ = { requestFns: [] };
	globalThis.__AMPLIFY_AUTH_MOCKS__ = {
		session: { tokens: {} },
		fetchCalls: 0,
		fetchImpl: null,
		...authMocks,
	};
	return import(`./auth-interceptor.ts?v=${cacheBust}`);
};

describe("installAuthInterceptor", () => {
	test("registers exactly one request interceptor when cognito is configured", async () => {
		const mod = await loadInterceptor(true, {});
		mod.installAuthInterceptor();
		assert.equal(globalThis.__REMIT_CLIENT_MOCKS__?.requestFns.length, 1);
	});

	test("is idempotent — subsequent calls do not register additional interceptors", async () => {
		const mod = await loadInterceptor(true, {});
		mod.installAuthInterceptor();
		mod.installAuthInterceptor();
		mod.installAuthInterceptor();
		assert.equal(globalThis.__REMIT_CLIENT_MOCKS__?.requestFns.length, 1);
	});

	test("does not register when cognito is not configured", async () => {
		const mod = await loadInterceptor(false, {});
		mod.installAuthInterceptor();
		assert.equal(globalThis.__REMIT_CLIENT_MOCKS__?.requestFns.length, 0);
	});

	test("attaches Bearer idToken header when session has tokens", async () => {
		const mod = await loadInterceptor(true, {
			session: {
				tokens: { idToken: idToken("ID-TOKEN-123") },
			},
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn, "expected interceptor fn to be registered");
		const req = new Request("https://api.example.com/thing");
		const out = await fn(req);
		assert.equal(out.headers.get("Authorization"), "Bearer ID-TOKEN-123");
	});

	test("omits Authorization header when session has no idToken", async () => {
		const mod = await loadInterceptor(true, {
			session: { tokens: {} },
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing");
		const out = await fn(req);
		assert.equal(out.headers.get("Authorization"), null);
	});

	test("omits Authorization header when tokens field is absent", async () => {
		const mod = await loadInterceptor(true, {
			session: {},
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing");
		const out = await fn(req);
		assert.equal(out.headers.get("Authorization"), null);
	});

	test("preserves caller-supplied headers when adding Authorization", async () => {
		const mod = await loadInterceptor(true, {
			session: {
				tokens: { idToken: idToken("TOK") },
			},
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing", {
			headers: { "X-Trace-Id": "abc-123", "Content-Type": "application/json" },
		});
		const out = await fn(req);
		assert.equal(out.headers.get("X-Trace-Id"), "abc-123");
		assert.equal(out.headers.get("Content-Type"), "application/json");
		assert.equal(out.headers.get("Authorization"), "Bearer TOK");
	});

	test("propagates errors when fetchAuthSession rejects (let it crash)", async () => {
		const mod = await loadInterceptor(true, {
			fetchImpl: () => {
				throw new Error("session fetch failed");
			},
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing");
		await assert.rejects(() => fn(req), /session fetch failed/);
	});

	test("reuses cached token across requests without re-fetching the session", async () => {
		const mod = await loadInterceptor(true, {
			session: { tokens: { idToken: idToken("CACHED") } },
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);

		const first = await fn(new Request("https://api.example.com/a"));
		const second = await fn(new Request("https://api.example.com/b"));

		assert.equal(first.headers.get("Authorization"), "Bearer CACHED");
		assert.equal(second.headers.get("Authorization"), "Bearer CACHED");
		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 1);
	});

	test("re-fetches the session when the cached token is near expiry", async () => {
		const almostExpired = Math.floor(Date.now() / 1000) + 5;
		const mod = await loadInterceptor(true, {
			session: { tokens: { idToken: idToken("STALE", almostExpired) } },
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);

		await fn(new Request("https://api.example.com/a"));
		await fn(new Request("https://api.example.com/b"));

		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 2);
	});

	test("resetTokenCache forces the next request to re-fetch the session", async () => {
		const mod = await loadInterceptor(true, {
			session: { tokens: { idToken: idToken("CACHED") } },
		});
		mod.installAuthInterceptor();
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);

		await fn(new Request("https://api.example.com/a"));
		mod.resetTokenCache();
		await fn(new Request("https://api.example.com/b"));

		assert.equal(globalThis.__AMPLIFY_AUTH_MOCKS__?.fetchCalls, 2);
	});
});
