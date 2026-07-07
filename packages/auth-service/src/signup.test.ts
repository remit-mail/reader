import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuth } from "./auth.js";
import { resolveSelfSignUpEnabled } from "./config.js";

describe("resolveSelfSignUpEnabled", () => {
	it("defaults to enabled when unset or blank", () => {
		assert.equal(resolveSelfSignUpEnabled(undefined), true);
		assert.equal(resolveSelfSignUpEnabled(""), true);
		assert.equal(resolveSelfSignUpEnabled("   "), true);
	});

	it("stays enabled for truthy or unrecognised values", () => {
		assert.equal(resolveSelfSignUpEnabled("true"), true);
		assert.equal(resolveSelfSignUpEnabled("1"), true);
		assert.equal(resolveSelfSignUpEnabled("yes"), true);
	});

	it("closes signup only for an explicit off value", () => {
		assert.equal(resolveSelfSignUpEnabled("false"), false);
		assert.equal(resolveSelfSignUpEnabled("0"), false);
		assert.equal(resolveSelfSignUpEnabled("no"), false);
	});

	it("matches off values case- and whitespace-insensitively", () => {
		assert.equal(resolveSelfSignUpEnabled(" FALSE "), false);
		assert.equal(resolveSelfSignUpEnabled("No"), false);
	});
});

const baseConfig = {
	connectionString: "postgresql://remit:remit@localhost:5432/remit_test",
	secret: "signup-test-secret-value-32chars-minimum",
	baseURL: "http://localhost:3000",
};

describe("createAuth self-signup gate", () => {
	it("flips better-auth disableSignUp from the selfSignUpEnabled flag", () => {
		const open = createAuth({ ...baseConfig, selfSignUpEnabled: true });
		const closed = createAuth({ ...baseConfig, selfSignUpEnabled: false });
		assert.equal(open.options.emailAndPassword?.disableSignUp, false);
		assert.equal(closed.options.emailAndPassword?.disableSignUp, true);
	});

	it("rejects a signup request server-side when disabled, before any DB access", async () => {
		const auth = createAuth({ ...baseConfig, selfSignUpEnabled: false });
		const request = new Request(
			"http://localhost:3000/api/auth/sign-up/email",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "nobody@example.com",
					password: "a-sufficiently-long-password",
					name: "Nobody",
				}),
			},
		);

		const response = await auth.handler(request);

		assert.equal(response.status, 400);
		const body = (await response.json()) as { code?: string };
		assert.equal(body.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
	});
});
