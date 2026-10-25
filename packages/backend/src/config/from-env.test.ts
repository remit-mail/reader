import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configFromEnv } from "./from-env.js";

const ORIGIN = "https://mail.example.com";
const GATEWAY = {
	PUBLIC_ORIGIN: ORIGIN,
	CONTENT_DELIVERY_DOMAIN: "https://d1.cloudfront.net",
};

describe("configFromEnv", () => {
	it("refuses to start without the public origin", () => {
		assert.throws(() => configFromEnv({}), /PUBLIC_ORIGIN is not set/);
		assert.throws(
			() => configFromEnv({ PUBLIC_ORIGIN: "" }),
			/PUBLIC_ORIGIN is not set/,
		);
	});

	it("refuses to start the self-host backend without its signing secret", () => {
		assert.throws(
			() => configFromEnv({ PUBLIC_ORIGIN: ORIGIN, DATA_BACKEND: "sqlite" }),
			/BETTER_AUTH_SECRET is not set/,
		);
	});

	it("refuses to start the gateway backend without the content domain (#299)", () => {
		assert.throws(
			() => configFromEnv({ PUBLIC_ORIGIN: ORIGIN }),
			/CONTENT_DELIVERY_DOMAIN is not set/,
		);
	});

	it("refuses to start Microsoft OAuth credentials without a redirect URI", () => {
		assert.throws(
			() =>
				configFromEnv({
					...GATEWAY,
					MSOAUTH_CLIENT_ID: "client-id",
					MSOAUTH_CLIENT_SECRET: "client-secret",
				}),
			/MSOAUTH_REDIRECT_URI is not set.*PUBLIC_ORIGIN/s,
		);
	});

	it("leaves Microsoft OAuth off when no credentials are configured", () => {
		assert.deepEqual(
			configFromEnv({
				...GATEWAY,
				MSOAUTH_REDIRECT_URI: `${ORIGIN}/cb`,
			}).msOAuth,
			{ mode: "Disabled" },
		);
	});

	it("reads a self-host deployment's keys into their modes", () => {
		const config = configFromEnv({
			PUBLIC_ORIGIN: ORIGIN,
			DATA_BACKEND: "sqlite",
			BETTER_AUTH_SECRET: "a-signing-secret-of-at-least-32-characters",
			CORS_ALLOWED_ORIGINS: ` ${ORIGIN} , http://localhost:5173,`,
			MSOAUTH_REDIRECT_URI: `${ORIGIN}/cb`,
			MSOAUTH_SECRET_ARN: "arn:aws:secretsmanager:eu-west-1:0:secret:ms",
			REMIT_UPDATE_MANIFEST_URL: "https://releases.example.com/manifest.json",
			STAGE_NAME: "dev",
		});

		assert.deepEqual(config.auth, {
			mode: "BetterAuthJwt",
			contentSigningSecret: "a-signing-secret-of-at-least-32-characters",
		});
		assert.deepEqual(config.corsAllowedOrigins, [
			ORIGIN,
			"http://localhost:5173",
		]);
		assert.equal(config.contentDeliveryDomain, ORIGIN);
		assert.equal(config.msOAuth.mode, "Enabled");
		assert.equal(
			config.msOAuth.mode === "Enabled" && config.msOAuth.redirectUri,
			`${ORIGIN}/cb`,
		);
		assert.equal(config.selfUpdate, "Enabled");
		assert.equal(config.responseValidation, "Log");
	});
});
