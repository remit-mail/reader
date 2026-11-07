import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createJsonLogger,
	isSecretKey,
	type LogBindings,
	redact,
} from "./index.js";

describe("isSecretKey", () => {
	it("matches secret names in any case and separator style", () => {
		for (const key of [
			"password",
			"PASSWORD",
			"secret",
			"clientSecret",
			"token",
			"accessToken",
			"refresh_token",
			"ACCESS-TOKEN",
			"accesstoken",
			"authorization",
			"Authorization",
			"cookie",
			"Set-Cookie",
			"apiKey",
			"x-api-key",
			"API_KEY",
		]) {
			assert.equal(isSecretKey(key), true, key);
		}
	});

	it("leaves names that only start with a secret word", () => {
		for (const key of [
			"tokenCount",
			"passwordLength",
			"secretsCount",
			"cookieJarSize",
			"key",
			"messageId",
		]) {
			assert.equal(isSecretKey(key), false, key);
		}
	});
});

describe("redact", () => {
	it("replaces secret values through nested objects and arrays", () => {
		const input = {
			user: "ann",
			tokenCount: 3,
			auth: { password: "hunter2", host: "imap.example.com" },
			accounts: [
				{ accessToken: "a1", id: 1 },
				{ RefreshToken: { nested: "r1" }, id: 2 },
			],
			headers: [["x"], { Authorization: "Bearer x", accept: "json" }],
		};
		assert.deepEqual(redact(input), {
			user: "ann",
			tokenCount: 3,
			auth: { password: "[redacted]", host: "imap.example.com" },
			accounts: [
				{ accessToken: "[redacted]", id: 1 },
				{ RefreshToken: "[redacted]", id: 2 },
			],
			headers: [["x"], { Authorization: "[redacted]", accept: "json" }],
		});
	});

	it("leaves the input untouched", () => {
		const input = { auth: { clientSecret: "s" } };
		redact(input);
		assert.equal(input.auth.clientSecret, "s");
	});

	it("passes primitives and toJSON objects through", () => {
		const when = new Date(0);
		assert.equal(redact("text"), "text");
		assert.equal(redact(null), null);
		assert.deepEqual(redact({ when }), { when });
	});

	it("keeps a cycle without recursing forever", () => {
		const input: LogBindings = { name: "loop", secret: "s" };
		input.self = input;
		const copy = redact(input) as LogBindings;
		assert.equal(copy.secret, "[redacted]");
		assert.equal(copy.self, copy);
	});
});

describe("createJsonLogger redaction", () => {
	it("redacts secrets in every line it writes, cycles included", () => {
		const lines: LogBindings[] = [];
		const log = createJsonLogger({
			write: (line) => lines.push(JSON.parse(line) as LogBindings),
		});
		const config: LogBindings = { apiKey: "k", host: "h" };
		config.parent = config;
		log.child({ token: "t" }).info({ config, tokenCount: 2 }, "connected");
		assert.deepEqual(lines[0]?.config, {
			apiKey: "[redacted]",
			host: "h",
			parent: "[Circular]",
		});
		assert.equal(lines[0]?.token, "[redacted]");
		assert.equal(lines[0]?.tokenCount, 2);
		assert.equal(lines[0]?.msg, "connected");
	});
});
