import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessHeaders, selectAuth, type TokenRun } from "./auth.ts";

const APP = "https://app.remit.email";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";

const neverRun = (): TokenRun => {
	throw new Error("cloudflared must not run when a service token is set");
};

describe("selectAuth", () => {
	it("prefers a service token when both halves are set", () => {
		assert.deepEqual(
			selectAuth({
				CF_ACCESS_CLIENT_ID: "id",
				CF_ACCESS_CLIENT_SECRET: "secret",
			}),
			{
				ok: true,
				auth: { kind: "ServiceToken", clientId: "id", clientSecret: "secret" },
			},
		);
	});

	it("falls back to the cloudflared user token when neither is set", () => {
		assert.deepEqual(selectAuth({}), { ok: true, auth: { kind: "UserToken" } });
	});

	it("refuses half a service token rather than silently using cloudflared", () => {
		for (const env of [
			{ CF_ACCESS_CLIENT_ID: "id" },
			{ CF_ACCESS_CLIENT_SECRET: "secret" },
		]) {
			const result = selectAuth(env);
			assert.equal(result.ok, false);
			assert.match(!result.ok ? result.message : "", /set both/);
		}
	});
});

describe("accessHeaders", () => {
	it("sends a service token as the two Access client headers", () => {
		assert.deepEqual(
			accessHeaders(
				{ kind: "ServiceToken", clientId: "id", clientSecret: "secret" },
				APP,
				neverRun,
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

	it("sends cloudflared's token as cf-access-token, asking for the app origin", () => {
		const asked: string[] = [];
		const result = accessHeaders({ kind: "UserToken" }, APP, (app) => {
			asked.push(app);
			return { kind: "Ran", stdout: `${JWT}\n` };
		});
		assert.deepEqual(result, { ok: true, headers: { "cf-access-token": JWT } });
		assert.deepEqual(asked, [APP]);
	});

	it("names the install when cloudflared is missing", () => {
		const result = accessHeaders({ kind: "UserToken" }, APP, () => ({
			kind: "Missing",
		}));
		assert.equal(result.ok, false);
		assert.match(
			!result.ok ? result.message : "",
			/cloudflared is not installed/,
		);
	});

	it("names the login when cloudflared has no token", () => {
		for (const stdout of [
			"",
			"Unable to find token for provided application.\n",
		]) {
			const result = accessHeaders({ kind: "UserToken" }, APP, () => ({
				kind: "Ran",
				stdout,
			}));
			assert.equal(result.ok, false);
			assert.match(
				!result.ok ? result.message : "",
				/run 'cloudflared access login https:\/\/app\.remit\.email'/,
			);
		}
	});
});
