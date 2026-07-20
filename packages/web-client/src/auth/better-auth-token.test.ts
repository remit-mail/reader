import assert from "node:assert";
import { afterEach, describe, test } from "node:test";
import {
	AuthTokenError,
	fetchBetterAuthToken,
	resetBetterAuthTokenCache,
} from "./better-auth-config";

const base64url = (value: string): string =>
	Buffer.from(value, "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

/** A token shaped like the one better-auth mints, expiring after `ttl` seconds. */
const jwtExpiringIn = (label: string, ttl: number): string =>
	`header.${base64url(
		JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttl, label }),
	)}.signature`;

/** A token shaped like the one better-auth mints, valid for an hour. */
const jwt = (label: string): string => jwtExpiringIn(label, 3600);

/**
 * A token past its comfortable-refresh window but not yet expired: `getToken`
 * treats it as needing a refresh while still holding it as a usable fallback.
 */
const nearExpiryJwt = (label: string): string => jwtExpiringIn(label, 30);

const realFetch = globalThis.fetch;

interface Stub {
	calls: number;
	release: () => void;
}

/** Stand in for the token endpoint, holding every request open until released. */
const stubTokenEndpoint = (respond: (call: number) => Response): Stub => {
	let open: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const stub: Stub = { calls: 0, release: () => open() };
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		assert.match(String(input), /\/api\/auth\/token$/);
		stub.calls += 1;
		const call = stub.calls;
		await gate;
		return respond(call);
	}) as typeof fetch;
	return stub;
};

const tokenResponse = (token: string): Response =>
	new Response(JSON.stringify({ token }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

afterEach(() => {
	globalThis.fetch = realFetch;
	resetBetterAuthTokenCache();
});

describe("fetchBetterAuthToken", () => {
	test("concurrent callers share one mint instead of each firing their own", async () => {
		const stub = stubTokenEndpoint((call) => tokenResponse(jwt(`t${call}`)));

		const pending = Array.from({ length: 12 }, () => fetchBetterAuthToken());
		stub.release();
		const tokens = await Promise.all(pending);

		assert.equal(stub.calls, 1);
		assert.equal(new Set(tokens).size, 1);
	});

	test("a token minted once is reused from cache, without a second request", async () => {
		const stub = stubTokenEndpoint(() => tokenResponse(jwt("cached")));
		stub.release();

		const first = await fetchBetterAuthToken();
		const second = await fetchBetterAuthToken();

		assert.equal(stub.calls, 1);
		assert.equal(second, first);
	});

	test("a rejected mint throws with its status rather than resolving to null", async () => {
		const stub = stubTokenEndpoint(
			() => new Response("", { status: 429, statusText: "Too Many Requests" }),
		);
		stub.release();

		await assert.rejects(
			() => fetchBetterAuthToken(),
			(error: unknown) => {
				assert.ok(error instanceof AuthTokenError);
				assert.equal(error.status, 429);
				return true;
			},
		);
	});

	test("a response carrying no token throws rather than resolving to null", async () => {
		const stub = stubTokenEndpoint(
			() =>
				new Response(JSON.stringify({}), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);
		stub.release();

		await assert.rejects(() => fetchBetterAuthToken(), AuthTokenError);
	});

	test("every caller sharing a failed mint sees the failure", async () => {
		const stub = stubTokenEndpoint(
			() => new Response("", { status: 429, statusText: "Too Many Requests" }),
		);

		const pending = Array.from({ length: 5 }, () =>
			fetchBetterAuthToken().then(
				() => "resolved",
				(error: unknown) =>
					error instanceof AuthTokenError ? "threw" : "other",
			),
		);
		stub.release();
		const outcomes = await Promise.all(pending);

		assert.equal(stub.calls, 1);
		assert.deepEqual(new Set(outcomes), new Set(["threw"]));
	});

	test("a failed mint is not replayed — the next caller mints again", async () => {
		const failing = stubTokenEndpoint(() => new Response("", { status: 500 }));
		failing.release();
		await assert.rejects(() => fetchBetterAuthToken());

		const succeeding = stubTokenEndpoint(() =>
			tokenResponse(jwt("after-failure")),
		);
		succeeding.release();

		assert.ok(await fetchBetterAuthToken());
		assert.equal(succeeding.calls, 1);
	});

	test("a network failure propagates instead of yielding a tokenless request", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("Failed to fetch");
		}) as typeof fetch;

		await assert.rejects(
			() => fetchBetterAuthToken(),
			/could not be completed|Failed to fetch/i,
		);
	});

	test("a throttled refresh keeps the still-valid token instead of discarding it", async () => {
		const seed = stubTokenEndpoint(() =>
			tokenResponse(nearExpiryJwt("still-valid")),
		);
		seed.release();
		const held = await fetchBetterAuthToken();

		const throttled = stubTokenEndpoint(
			() => new Response("", { status: 429, statusText: "Too Many Requests" }),
		);
		throttled.release();
		const afterThrottle = await fetchBetterAuthToken();

		assert.equal(throttled.calls, 1);
		assert.equal(afterThrottle, held);
	});

	test("after a throttled refresh it backs off rather than hammering the endpoint", async () => {
		const seed = stubTokenEndpoint(() =>
			tokenResponse(nearExpiryJwt("still-valid")),
		);
		seed.release();
		const held = await fetchBetterAuthToken();

		const throttled = stubTokenEndpoint(
			() => new Response("", { status: 429, statusText: "Too Many Requests" }),
		);
		throttled.release();
		await fetchBetterAuthToken();

		const first = await fetchBetterAuthToken();
		const second = await fetchBetterAuthToken();

		assert.equal(throttled.calls, 1);
		assert.equal(first, held);
		assert.equal(second, held);
	});

	test("a throttled refresh with no usable token to fall back on still throws", async () => {
		const seed = stubTokenEndpoint(() =>
			tokenResponse(jwtExpiringIn("already-expired", -10)),
		);
		seed.release();
		await fetchBetterAuthToken();

		const throttled = stubTokenEndpoint(
			() => new Response("", { status: 429, statusText: "Too Many Requests" }),
		);
		throttled.release();

		await assert.rejects(
			() => fetchBetterAuthToken(),
			(error: unknown) => {
				assert.ok(error instanceof AuthTokenError);
				assert.equal(error.status, 429);
				return true;
			},
		);
	});
});
