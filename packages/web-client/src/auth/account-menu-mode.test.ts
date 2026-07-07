import assert from "node:assert";
import { describe, test } from "node:test";
import { COGNITO_FOOTER_NOTE } from "@remit/ui";
import { accountMenuMode, authFooterNote } from "./account-menu-mode";

describe("accountMenuMode", () => {
	test("prefers better-auth when enabled", () => {
		assert.equal(
			accountMenuMode({ betterAuthEnabled: true, cognitoConfigured: false }),
			"betterAuth",
		);
	});

	test("better-auth wins even when cognito is also configured", () => {
		assert.equal(
			accountMenuMode({ betterAuthEnabled: true, cognitoConfigured: true }),
			"betterAuth",
		);
	});

	test("falls back to cognito when only cognito is configured", () => {
		assert.equal(
			accountMenuMode({ betterAuthEnabled: false, cognitoConfigured: true }),
			"cognito",
		);
	});

	test("renders nothing when neither identity provider is active", () => {
		assert.equal(
			accountMenuMode({ betterAuthEnabled: false, cognitoConfigured: false }),
			"none",
		);
	});
});

describe("authFooterNote", () => {
	test("names Cognito only when Cognito is the active provider", () => {
		assert.equal(
			authFooterNote({ betterAuthEnabled: false, cognitoConfigured: true }),
			COGNITO_FOOTER_NOTE,
		);
	});

	test("stays provider-neutral in better-auth mode", () => {
		assert.equal(
			authFooterNote({ betterAuthEnabled: true, cognitoConfigured: false }),
			undefined,
		);
	});

	test("stays provider-neutral when better-auth wins over present cognito env", () => {
		assert.equal(
			authFooterNote({ betterAuthEnabled: true, cognitoConfigured: true }),
			undefined,
		);
	});

	test("stays provider-neutral when no provider is configured", () => {
		assert.equal(
			authFooterNote({ betterAuthEnabled: false, cognitoConfigured: false }),
			undefined,
		);
	});
});
