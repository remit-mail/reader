import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AuthIo, authHeaders, selectAuth } from "./auth.ts";
import type { Target } from "./target.ts";

const CLOUDFLARE: Target = {
	kind: "cloudflare",
	apiUrl: "https://app.remit.email/api",
	origin: "https://app.remit.email",
};
const STANDALONE: Target = {
	kind: "standalone",
	apiUrl: "http://apisix:9080",
	origin: "http://apisix:9080",
};
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";

const untouched: AuthIo = {
	runCloudflared: () => assert.fail("cloudflared must not run"),
	signIn: () => assert.fail("sign-in must not run"),
};

describe("selectAuth on the cloudflare target", () => {
	it("prefers a service token when both halves are set", () => {
		assert.deepEqual(
			selectAuth("cloudflare", {
				CF_ACCESS_CLIENT_ID: "id",
				CF_ACCESS_CLIENT_SECRET: "secret",
			}),
			{
				ok: true,
				auth: { kind: "ServiceToken", clientId: "id", clientSecret: "secret" },
			},
		);
	});

	it("falls back to the cloudflared user token", () => {
		assert.deepEqual(selectAuth("cloudflare", {}), {
			ok: true,
			auth: { kind: "AccessUserToken" },
		});
	});

	it("refuses half a service token", () => {
		const result = selectAuth("cloudflare", { CF_ACCESS_CLIENT_ID: "id" });
		assert.match(!result.ok ? result.message : "", /set both/);
	});
});

describe("selectAuth on the standalone target", () => {
	it("prefers REMIT_TOKEN over a password", () => {
		assert.deepEqual(
			selectAuth("standalone", {
				REMIT_TOKEN: JWT,
				REMIT_EMAIL: "me@example.com",
				REMIT_PASSWORD: "pw",
			}),
			{ ok: true, auth: { kind: "Bearer", token: JWT } },
		);
	});

	it("signs in with REMIT_EMAIL and REMIT_PASSWORD", () => {
		assert.deepEqual(
			selectAuth("standalone", {
				REMIT_EMAIL: "me@example.com",
				REMIT_PASSWORD: "pw",
			}),
			{
				ok: true,
				auth: { kind: "Password", email: "me@example.com", password: "pw" },
			},
		);
	});

	it("names the fix when nothing is set, ignoring the Access variables", () => {
		const result = selectAuth("standalone", {
			CF_ACCESS_CLIENT_ID: "id",
			CF_ACCESS_CLIENT_SECRET: "secret",
			REMIT_EMAIL: "me@example.com",
		});
		assert.match(
			!result.ok ? result.message : "",
			/set REMIT_EMAIL and REMIT_PASSWORD .* or REMIT_TOKEN/,
		);
	});
});

describe("authHeaders", () => {
	it("sends a service token as the two Access client headers", async () => {
		assert.deepEqual(
			await authHeaders(
				{ kind: "ServiceToken", clientId: "id", clientSecret: "secret" },
				CLOUDFLARE,
				untouched,
			),
			{
				ok: true,
				headers: {
					"CF-Access-Client-Id": "id",
					"CF-Access-Client-Secret": "secret",
				},
			},
		);
	});

	it("sends cloudflared's token as cf-access-token for the app origin", async () => {
		const asked: string[] = [];
		const result = await authHeaders({ kind: "AccessUserToken" }, CLOUDFLARE, {
			...untouched,
			runCloudflared: (origin) => {
				asked.push(origin);
				return { kind: "Ran", stdout: `${JWT}\n` };
			},
		});
		assert.deepEqual(result, { ok: true, headers: { "cf-access-token": JWT } });
		assert.deepEqual(asked, ["https://app.remit.email"]);
	});

	it("names the install when cloudflared is missing, and the login when it has no token", async () => {
		const missing = await authHeaders({ kind: "AccessUserToken" }, CLOUDFLARE, {
			...untouched,
			runCloudflared: () => ({ kind: "Missing" }),
		});
		assert.match(
			!missing.ok ? missing.message : "",
			/cloudflared is not installed/,
		);
		const empty = await authHeaders({ kind: "AccessUserToken" }, CLOUDFLARE, {
			...untouched,
			runCloudflared: () => ({ kind: "Ran", stdout: "" }),
		});
		assert.match(
			!empty.ok ? empty.message : "",
			/run 'cloudflared access login https:\/\/app\.remit\.email'/,
		);
	});

	it("sends the minted session token as a bearer on the standalone target", async () => {
		const result = await authHeaders(
			{ kind: "Password", email: "me@example.com", password: "pw" },
			STANDALONE,
			{
				...untouched,
				signIn: async (target, email, password) => {
					assert.deepEqual(
						[target.origin, email, password],
						["http://apisix:9080", "me@example.com", "pw"],
					);
					return { ok: true, token: JWT };
				},
			},
		);
		assert.deepEqual(result, {
			ok: true,
			headers: { Authorization: `Bearer ${JWT}` },
		});
	});
});
