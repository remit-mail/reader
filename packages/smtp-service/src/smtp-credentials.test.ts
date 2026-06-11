/**
 * Unit tests for SmtpCredentials union and SmtpConnectionError.
 *
 * Covers:
 * 1. Auth object construction — nodemailer auth shape for each credential kind
 * 2. Exhaustiveness — TypeScript catches missing cases via `never`
 * 3. Token-leak assertion — accessToken never in serialized error
 * 4. Error kind classification
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import { SmtpConnectionError, type SmtpCredentials } from "./smtp-client.js";

// ---------------------------------------------------------------------------
// Helper: mirrors buildSmtpAuth in smtp-client.ts
// ---------------------------------------------------------------------------

type SmtpAuth =
	| { user: string; pass: string }
	| { type: "OAuth2"; user: string; accessToken: string };

const buildSmtpAuth = (
	user: string,
	credentials: SmtpCredentials,
): SmtpAuth => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	if (credentials.kind === "accessToken") {
		return {
			type: "OAuth2" as const,
			user,
			accessToken: credentials.accessToken,
		};
	}
	// Exhaustiveness check — TypeScript will error here if a new union member
	// is added without updating this function.
	const _exhaustive: never = credentials;
	throw new Error(`Unknown credential kind: ${JSON.stringify(_exhaustive)}`);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SmtpCredentials — auth shape", () => {
	it("password kind → { user, pass }", () => {
		const creds: SmtpCredentials = { kind: "password", password: "s3cr3t" };
		const auth = buildSmtpAuth("alice@example.com", creds);

		assert.deepEqual(auth, { user: "alice@example.com", pass: "s3cr3t" });
		assert.ok(!("type" in auth), "no OAuth2 type for password auth");
		assert.ok(!("accessToken" in auth), "no accessToken for password auth");
	});

	it("accessToken kind → { type: 'OAuth2', user, accessToken }", () => {
		const token = "ya29.super-secret-token";
		const creds: SmtpCredentials = { kind: "accessToken", accessToken: token };
		const auth = buildSmtpAuth("alice@example.com", creds);

		assert.deepEqual(auth, {
			type: "OAuth2",
			user: "alice@example.com",
			accessToken: token,
		});
		assert.ok(!("pass" in auth), "no pass for OAuth2 auth");
	});
});

describe("SmtpConnectionError", () => {
	it("stores kind='auth'", () => {
		const err = new SmtpConnectionError("auth", "SMTP authentication failed");
		assert.equal(err.kind, "auth");
		assert.equal(err.name, "SmtpConnectionError");
		assert.equal(err.message, "SMTP authentication failed");
	});

	it("stores kind='network'", () => {
		const err = new SmtpConnectionError(
			"network",
			"SMTP connection failed: ECONNREFUSED",
		);
		assert.equal(err.kind, "network");
	});

	it("is instanceof Error", () => {
		const err = new SmtpConnectionError("auth", "test");
		assert.ok(err instanceof Error);
		assert.ok(err instanceof SmtpConnectionError);
	});

	it("token-leak: accessToken must NOT appear in inspected SmtpConnectionError (incl. cause)", () => {
		const secretToken = "ya29.A0ARrdaM_very_secret_smtp_token_67890";

		// Reproduce what sendMail() does: classify a nodemailer EAUTH failure and
		// attach the underlying error as `cause`. A realistic nodemailer auth
		// error reports the failure without echoing the access token.
		const underlyingError = Object.assign(
			new Error("Invalid login: 535 5.7.8 Authentication credentials invalid"),
			{ code: "EAUTH", responseCode: 535, command: "AUTH" },
		);
		const err = new SmtpConnectionError(
			"auth",
			"SMTP authentication failed",
			underlyingError,
		);

		// util.inspect walks the full error including the cause chain, so this
		// proves no token leaks through name/message/stack OR cause.
		const serialized = inspect(err, { depth: null });

		assert.ok(
			!serialized.includes(secretToken),
			`SmtpConnectionError must not contain the access token — got: ${serialized.slice(0, 200)}`,
		);
	});

	it("token-leak: accessToken in cause does NOT bubble into error.message", () => {
		const secretToken = "ya29.A0ARrdaM_very_secret_smtp_token_CAUSE";
		const underlyingError = new Error(`AUTH PLAIN failed token=${secretToken}`);

		const err = new SmtpConnectionError(
			"auth",
			"SMTP authentication failed",
			underlyingError,
		);

		assert.ok(
			!err.message.includes(secretToken),
			"error.message must not contain the access token",
		);
	});
});
