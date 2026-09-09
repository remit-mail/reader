import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getMsOAuthConfig } from "./msoauth.js";

const MSOAUTH_KEYS = [
	"MSOAUTH_AUTHORITY",
	"MSOAUTH_REDIRECT_URI",
	"MSOAUTH_SECRET_ARN",
	"MSOAUTH_CLIENT_ID",
	"MSOAUTH_CLIENT_SECRET",
	"MSOAUTH_TOKEN_ENDPOINT",
] as const;

describe("getMsOAuthConfig", () => {
	const original = new Map(
		MSOAUTH_KEYS.map((key) => [key, process.env[key]] as const),
	);

	afterEach(() => {
		for (const [key, value] of original) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("resolves on a self-host deployment, where no authority is wired", () => {
		for (const key of MSOAUTH_KEYS) delete process.env[key];
		process.env.MSOAUTH_REDIRECT_URI =
			"https://mail.example.com/api/accounts/oauth/microsoft/callback";
		process.env.MSOAUTH_CLIENT_ID = "client-id";
		process.env.MSOAUTH_CLIENT_SECRET = "client-secret";

		assert.deepEqual(getMsOAuthConfig(), {
			secretArn: undefined,
			redirectUri:
				"https://mail.example.com/api/accounts/oauth/microsoft/callback",
			clientId: "client-id",
			clientSecret: "client-secret",
			tokenEndpoint: undefined,
		});
	});

	it("names PUBLIC_ORIGIN when the redirect URI is missing", () => {
		for (const key of MSOAUTH_KEYS) delete process.env[key];

		assert.throws(getMsOAuthConfig, /MSOAUTH_REDIRECT_URI.*PUBLIC_ORIGIN/s);
	});
});
