import assert from "node:assert";
import { describe, test } from "node:test";
import { AuthTokenError } from "./better-auth-config";
import { type AuthProvider, noneAuthProvider } from "./provider";

type RequestFn = (req: Request) => Promise<Request>;

declare global {
	// eslint-disable-next-line no-var
	var __REMIT_CLIENT_MOCKS__: { requestFns: RequestFn[] } | undefined;
}

let cacheBust = 1000;

const providerWithToken = (
	getToken: AuthProvider["getToken"],
): AuthProvider => ({ ...noneAuthProvider, getToken });

const loadInterceptor = async () => {
	cacheBust += 1;
	globalThis.__REMIT_CLIENT_MOCKS__ = { requestFns: [] };
	return import(`./auth-interceptor.ts?v=${cacheBust}`);
};

describe("installAuthInterceptor", () => {
	test("registers exactly one request interceptor", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => null));
		assert.equal(globalThis.__REMIT_CLIENT_MOCKS__?.requestFns.length, 1);
	});

	test("is idempotent — subsequent calls do not register additional interceptors", async () => {
		const mod = await loadInterceptor();
		const provider = providerWithToken(async () => null);
		mod.installAuthInterceptor(provider);
		mod.installAuthInterceptor(provider);
		mod.installAuthInterceptor(provider);
		assert.equal(globalThis.__REMIT_CLIENT_MOCKS__?.requestFns.length, 1);
	});

	test("attaches the provider's Bearer token when one exists", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => "ID-TOKEN-123"));
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn, "expected interceptor fn to be registered");
		const req = new Request("https://api.example.com/thing");
		const out = await fn(req);
		assert.equal(out.headers.get("Authorization"), "Bearer ID-TOKEN-123");
	});

	test("abandons the request when the token cannot be minted — never sends it unauthenticated", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(
			providerWithToken(async () => {
				throw new AuthTokenError("Could not mint a session token: 429", 429);
			}),
		);
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing");
		await assert.rejects(
			() => fn(req),
			(error: unknown) => {
				assert.ok(error instanceof AuthTokenError);
				assert.equal(error.status, 429);
				return true;
			},
		);
		assert.equal(req.headers.get("Authorization"), null);
	});

	test("omits Authorization header when the deployment presents no identity", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => null));
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing");
		const out = await fn(req);
		assert.equal(out.headers.get("Authorization"), null);
	});

	test("preserves caller-supplied headers when adding Authorization", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => "TOK"));
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

	test("propagates errors when the provider's getToken rejects (let it crash)", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(
			providerWithToken(async () => {
				throw new Error("session fetch failed");
			}),
		);
		const fn = globalThis.__REMIT_CLIENT_MOCKS__?.requestFns[0];
		assert.ok(fn);
		const req = new Request("https://api.example.com/thing");
		await assert.rejects(() => fn(req), /session fetch failed/);
	});
});
