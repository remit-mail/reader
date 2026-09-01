import assert from "node:assert";
import { afterEach, describe, test } from "node:test";
import { client } from "@remit/api-http-client/client.gen.ts";
import { trashOperationsEmptyTrash } from "@remit/api-http-client/sdk.gen.ts";
import { type HttpMock, mockFetch } from "../test-support/http";
import { AuthTokenError } from "./better-auth-config";
import { type AuthProvider, noneAuthProvider } from "./provider";

let cacheBust = 1000;
let http: HttpMock | undefined;

afterEach(() => {
	http?.restore();
	http = undefined;
	client.interceptors.request.clear();
});

const providerWithToken = (
	getToken: AuthProvider["getToken"],
): AuthProvider => ({ ...noneAuthProvider, getToken });

const loadInterceptor = async () => {
	cacheBust += 1;
	client.interceptors.request.clear();
	return import(`./auth-interceptor.ts?v=${cacheBust}`);
};

const send = (headers?: Record<string, string>): Promise<unknown> => {
	http = mockFetch();
	return trashOperationsEmptyTrash({
		path: { accountId: "acc-1" },
		headers,
		throwOnError: true,
	});
};

const sentHeaders = (): Record<string, string> => {
	assert.ok(http, "expected a request to have been sent");
	assert.equal(http.calls.length, 1);
	return http.calls[0].headers;
};

describe("installAuthInterceptor", () => {
	test("registers exactly one request interceptor", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => null));
		assert.equal(client.interceptors.request.fns.length, 1);
	});

	test("is idempotent — subsequent calls do not register additional interceptors", async () => {
		const mod = await loadInterceptor();
		const provider = providerWithToken(async () => null);
		mod.installAuthInterceptor(provider);
		mod.installAuthInterceptor(provider);
		mod.installAuthInterceptor(provider);
		assert.equal(client.interceptors.request.fns.length, 1);
	});

	test("attaches the provider's Bearer token when one exists", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => "ID-TOKEN-123"));
		await send();
		assert.equal(sentHeaders().authorization, "Bearer ID-TOKEN-123");
	});

	test("abandons the request when the token cannot be minted — never sends it unauthenticated", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(
			providerWithToken(async () => {
				throw new AuthTokenError("Could not mint a session token: 429", 429);
			}),
		);
		await assert.rejects(
			() => send(),
			(error: unknown) => {
				assert.ok(error instanceof AuthTokenError);
				assert.equal(error.status, 429);
				return true;
			},
		);
		assert.equal(http?.calls.length, 0);
	});

	test("omits Authorization header when the deployment presents no identity", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => null));
		await send();
		assert.equal(sentHeaders().authorization, undefined);
	});

	test("preserves caller-supplied headers when adding Authorization", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(providerWithToken(async () => "TOK"));
		await send({ "X-Trace-Id": "abc-123", "X-Client": "reader" });
		const headers = sentHeaders();
		assert.equal(headers["x-trace-id"], "abc-123");
		assert.equal(headers["x-client"], "reader");
		assert.equal(headers.authorization, "Bearer TOK");
	});

	test("propagates errors when the provider's getToken rejects (let it crash)", async () => {
		const mod = await loadInterceptor();
		mod.installAuthInterceptor(
			providerWithToken(async () => {
				throw new Error("session fetch failed");
			}),
		);
		await assert.rejects(() => send(), /session fetch failed/);
	});
});
