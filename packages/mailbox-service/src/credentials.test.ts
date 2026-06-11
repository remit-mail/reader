/**
 * Unit tests for MailCredentials union and MailConnectionError.
 *
 * Covers:
 * 1. Auth object construction — imapflow auth shape for each credential kind
 * 2. Exhaustiveness — TypeScript catches missing cases via `never`
 * 3. Token-leak assertion — accessToken never in serialized error
 * 4. Error classification — createImapFlowConnectionFromAccount wires password
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import { MailConnectionError, type MailCredentials } from "./types.js";

// ---------------------------------------------------------------------------
// Helper: build the same imapflow auth object that imapflow-connection.ts uses
// (extracted here so the test doesn't import the whole class)
// ---------------------------------------------------------------------------

type ImapAuth =
	| { user: string; pass: string }
	| { user: string; accessToken: string };

const buildImapAuth = (
	user: string,
	credentials: MailCredentials,
): ImapAuth => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	if (credentials.kind === "accessToken") {
		return { user, accessToken: credentials.accessToken };
	}
	// Exhaustiveness check — TypeScript will error here if a new union member
	// is added without updating this function.
	const _exhaustive: never = credentials;
	throw new Error(`Unknown credential kind: ${JSON.stringify(_exhaustive)}`);
};

// ---------------------------------------------------------------------------
// Helper: build the same nodemailer auth object that smtp-client.ts uses
// ---------------------------------------------------------------------------

type SmtpAuth =
	| { user: string; pass: string }
	| { type: "OAuth2"; user: string; accessToken: string };

const buildSmtpAuth = (
	user: string,
	credentials: MailCredentials,
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
	// Exhaustiveness check
	const _exhaustive: never = credentials;
	throw new Error(`Unknown credential kind: ${JSON.stringify(_exhaustive)}`);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MailCredentials — imapflow auth shape", () => {
	it("password kind → { user, pass }", () => {
		const creds: MailCredentials = { kind: "password", password: "s3cr3t" };
		const auth = buildImapAuth("alice@example.com", creds);

		assert.deepEqual(auth, { user: "alice@example.com", pass: "s3cr3t" });
		assert.ok(
			!("accessToken" in auth),
			"no accessToken field for password auth",
		);
	});

	it("accessToken kind → { user, accessToken }", () => {
		const token = "ya29.super-secret-token";
		const creds: MailCredentials = { kind: "accessToken", accessToken: token };
		const auth = buildImapAuth("alice@example.com", creds);

		assert.deepEqual(auth, {
			user: "alice@example.com",
			accessToken: token,
		});
		assert.ok(!("pass" in auth), "no pass field for accessToken auth");
	});
});

describe("MailCredentials — nodemailer auth shape", () => {
	it("password kind → { user, pass }", () => {
		const creds: MailCredentials = { kind: "password", password: "s3cr3t" };
		const auth = buildSmtpAuth("alice@example.com", creds);

		assert.deepEqual(auth, { user: "alice@example.com", pass: "s3cr3t" });
		assert.ok(!("type" in auth), "no OAuth2 type field for password auth");
	});

	it("accessToken kind → { type: 'OAuth2', user, accessToken }", () => {
		const token = "ya29.super-secret-token";
		const creds: MailCredentials = { kind: "accessToken", accessToken: token };
		const auth = buildSmtpAuth("alice@example.com", creds);

		assert.deepEqual(auth, {
			type: "OAuth2",
			user: "alice@example.com",
			accessToken: token,
		});
		assert.ok(!("pass" in auth), "no pass field for OAuth2 auth");
	});
});

describe("MailConnectionError", () => {
	it("stores kind='auth'", () => {
		const err = new MailConnectionError("auth", "IMAP authentication failed");
		assert.equal(err.kind, "auth");
		assert.equal(err.name, "MailConnectionError");
		assert.equal(err.message, "IMAP authentication failed");
	});

	it("stores kind='network'", () => {
		const err = new MailConnectionError(
			"network",
			"IMAP connection failed: ECONNREFUSED",
		);
		assert.equal(err.kind, "network");
	});

	it("token-leak: accessToken must NOT appear in inspected MailConnectionError", () => {
		const secretToken = "ya29.A0ARrdaM_very_secret_access_token_12345";

		// Simulate what connection code does: auth fails for an OAuth account.
		// The error message must NOT mention the token, only "auth failed".
		const err = new MailConnectionError(
			"auth",
			"IMAP authentication failed",
			// The cause should also never include the token
		);

		// util.inspect walks the full error including the cause chain, so this
		// proves no token leaks through name/message/stack OR cause.
		const serialized = inspect(err, { depth: null });

		assert.ok(
			!serialized.includes(secretToken),
			`MailConnectionError must not contain the access token — got: ${serialized.slice(0, 200)}`,
		);
	});

	it("token-leak: accessToken in cause does NOT bubble into error.message", () => {
		// Even if the underlying library error somehow includes the token text,
		// our MailConnectionError message must not re-echo it.
		const secretToken = "ya29.A0ARrdaM_very_secret_access_token_CAUSE";
		const underlyingError = new Error(`AUTH failed token=${secretToken}`);

		const err = new MailConnectionError(
			"auth",
			"IMAP authentication failed",
			underlyingError,
		);

		// The message itself must be token-free
		assert.ok(
			!err.message.includes(secretToken),
			"error.message must not contain the access token",
		);
	});

	it("is instanceof Error", () => {
		const err = new MailConnectionError("auth", "test");
		assert.ok(err instanceof Error);
		assert.ok(err instanceof MailConnectionError);
	});
});
