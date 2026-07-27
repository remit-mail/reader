/**
 * The client's recovery from an expired bearer, proven against a stubbed
 * `fetch` so the behaviour is checked without a running deployment.
 *
 * The gateway-verified token lives 15 minutes; a saturated run outlasts it and
 * every request after expiry comes back 401. The client re-mints once through
 * the sign-in path and replays — and only on a 401.
 */
import { expect, test } from "@playwright/test";
import { ApiClient } from "../src/api.js";

const STALE = "Bearer stale-token";
const FRESH_TOKEN = "fresh-token";

const session = {
	email: "e2e@remit.test",
	password: "e2e-password-1234",
	token: "stale-token",
};

interface FetchCounts {
	signIn: number;
	tokenExchange: number;
	business: number;
}

/**
 * Stand in for the deployment. The business route answers 401 for the stale
 * bearer and 200 once the client presents the re-minted one; the auth routes
 * hand back a session cookie and the fresh token. `signInGate`, when supplied,
 * holds sign-in open until released so a test can line several requests up
 * behind one in-flight re-mint.
 */
const stubFetch = (
	counts: FetchCounts,
	options: { businessStatus?: number; signInGate?: Promise<void> } = {},
): typeof fetch => {
	const businessStatus = options.businessStatus ?? 401;
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.endsWith("/api/auth/sign-in/email")) {
			counts.signIn += 1;
			if (options.signInGate) await options.signInGate;
			return new Response("{}", {
				headers: [["set-cookie", "session=cookie-value; Path=/"]],
			});
		}
		if (url.endsWith("/api/auth/token")) {
			counts.tokenExchange += 1;
			return new Response(JSON.stringify({ token: FRESH_TOKEN }), {
				headers: { "content-type": "application/json" },
			});
		}
		counts.business += 1;
		const authorized =
			new Headers(init?.headers).get("authorization") ===
			`Bearer ${FRESH_TOKEN}`;
		const status = authorized ? 200 : businessStatus;
		return new Response(JSON.stringify({ ok: authorized }), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
};

const withStub = async (
	stub: typeof fetch,
	body: () => Promise<void>,
): Promise<void> => {
	const original = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await body();
	} finally {
		globalThis.fetch = original;
	}
};

test("re-mints once on 401 and replays the request", async () => {
	const counts: FetchCounts = { signIn: 0, tokenExchange: 0, business: 0 };
	await withStub(stubFetch(counts), async () => {
		const client = new ApiClient({ ...session });
		const response = await client.request("GET", "/mailboxes/x/threads");
		expect(response.status).toBe(200);
	});
	expect(counts.signIn).toBe(1);
	expect(counts.tokenExchange).toBe(1);
	// The first attempt (401) plus the replay after re-mint.
	expect(counts.business).toBe(99);
});

test("does not re-mint on a non-401 failure", async () => {
	const counts: FetchCounts = { signIn: 0, tokenExchange: 0, business: 0 };
	await withStub(stubFetch(counts, { businessStatus: 500 }), async () => {
		const client = new ApiClient({ ...session });
		const response = await client.request("GET", "/mailboxes/x/threads");
		expect(response.status).toBe(500);
	});
	expect(counts.signIn).toBe(0);
	expect(counts.business).toBe(1);
});

test("concurrent 401s share one re-mint", async () => {
	const counts: FetchCounts = { signIn: 0, tokenExchange: 0, business: 0 };
	let release = (): void => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await withStub(stubFetch(counts, { signInGate: gate }), async () => {
		const client = new ApiClient({ ...session });
		const inFlight = [
			client.request("GET", "/mailboxes/x/threads"),
			client.request("GET", "/threads"),
			client.request("GET", "/addresses/search?q=a"),
		];
		// Let every request reach its first 401 and latch onto the shared re-mint
		// before sign-in is allowed to complete.
		await Promise.resolve();
		release();
		const responses = await Promise.all(inFlight);
		for (const response of responses) expect(response.status).toBe(200);
	});
	expect(counts.signIn).toBe(1);
	expect(counts.tokenExchange).toBe(1);
	expect(counts.business).toBe(6);
});

test("uses the stale bearer before expiry, without re-minting", async () => {
	const counts: FetchCounts = { signIn: 0, tokenExchange: 0, business: 0 };
	let seenAuthorization = "";
	const recordingStub: typeof fetch = (async (
		_input: string | URL | Request,
		init?: RequestInit,
	) => {
		counts.business += 1;
		seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	await withStub(recordingStub, async () => {
		const client = new ApiClient({ ...session });
		const response = await client.request("GET", "/threads");
		expect(response.status).toBe(200);
	});
	expect(seenAuthorization).toBe(STALE);
	expect(counts.signIn).toBe(0);
	expect(counts.business).toBe(1);
});
