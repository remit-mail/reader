import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInvocation, STANDALONE_API_URL } from "./target.ts";

describe("parseInvocation", () => {
	it("defaults to the standalone stack's own gateway", () => {
		assert.deepEqual(parseInvocation(["status"], {}), {
			ok: true,
			target: {
				kind: "standalone",
				apiUrl: STANDALONE_API_URL,
				origin: STANDALONE_API_URL,
			},
			command: "status",
			args: [],
		});
	});

	it("reads REMIT_API_URL as the cloudflare target", () => {
		assert.deepEqual(
			parseInvocation(["sync", "me@example.com"], {
				REMIT_API_URL: "https://app.remit.email/api/",
			}),
			{
				ok: true,
				target: {
					kind: "cloudflare",
					apiUrl: "https://app.remit.email/api",
					origin: "https://app.remit.email",
				},
				command: "sync",
				args: ["me@example.com"],
			},
		);
	});

	it("lets --target and --api-url override the environment, in either form", () => {
		const result = parseInvocation(
			[
				"--target=standalone",
				"--api-url",
				"https://mail.example.com",
				"status",
			],
			{ REMIT_API_URL: "https://app.remit.email/api" },
		);
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.target, {
			kind: "standalone",
			apiUrl: "https://mail.example.com/api",
			origin: "https://mail.example.com",
		});
		assert.equal(result.command, "status");
	});

	it("reads --api-url without --target as the cloudflare target", () => {
		const result = parseInvocation(
			["--api-url", "https://app.remit.email/api", "status"],
			{},
		);
		assert.equal(result.ok && result.target.kind, "cloudflare");
	});

	it("refuses a cloudflare target without a URL", () => {
		const result = parseInvocation(["--target", "cloudflare", "status"], {});
		assert.equal(result.ok, false);
		assert.match(!result.ok ? result.message : "", /REMIT_API_URL/);
	});

	it("refuses an unknown target and a flag with no value", () => {
		for (const argv of [
			["--target", "lambda", "status"],
			["--target"],
			["--api-url=", "status"],
		]) {
			assert.equal(parseInvocation(argv, {}).ok, false, argv.join(" "));
		}
	});
});
