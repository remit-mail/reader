import assert from "node:assert";
import { describe, test } from "node:test";
import {
	accountIsMissingSmtp,
	appendAppPasswordHint,
	computeSmtpAutoFill,
	deriveSmtpHostFromImap,
	isAuthError,
} from "./account-form-helpers.js";

describe("deriveSmtpHostFromImap", () => {
	test("rewrites imap.* to smtp.*", () => {
		assert.equal(
			deriveSmtpHostFromImap("imap.example.com"),
			"smtp.example.com",
		);
	});

	test("matches the imap. prefix case-insensitively", () => {
		assert.equal(
			deriveSmtpHostFromImap("IMAP.example.com"),
			"smtp.example.com",
		);
	});

	test("returns the host unchanged when no imap. prefix is present", () => {
		assert.equal(
			deriveSmtpHostFromImap("mail.example.com"),
			"mail.example.com",
		);
	});

	test("only rewrites the prefix, not other occurrences of imap", () => {
		assert.equal(
			deriveSmtpHostFromImap("imap.imap-server.example.com"),
			"smtp.imap-server.example.com",
		);
	});
});

describe("computeSmtpAutoFill", () => {
	test("fills SMTP fields when SMTP host is empty and IMAP host is set", () => {
		const result = computeSmtpAutoFill({
			imapHost: "imap.example.com",
			smtpHost: "",
		});
		assert.deepEqual(result, {
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpTls: false,
			smtpStartTls: true,
		});
	});

	test("fills SMTP fields when SMTP host is undefined and IMAP host is set", () => {
		const result = computeSmtpAutoFill({
			imapHost: "imap.example.com",
		});
		assert.deepEqual(result, {
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			smtpTls: false,
			smtpStartTls: true,
		});
	});

	test("fills SMTP fields when SMTP host is whitespace", () => {
		const result = computeSmtpAutoFill({
			imapHost: "imap.example.com",
			smtpHost: "   ",
		});
		assert.notEqual(result, null);
		assert.equal(result?.smtpHost, "smtp.example.com");
	});

	test("returns null when SMTP host is already set — never overrides user input", () => {
		const result = computeSmtpAutoFill({
			imapHost: "imap.example.com",
			smtpHost: "smtp.different.com",
			smtpPort: 465,
			smtpTls: true,
			smtpStartTls: false,
		});
		assert.equal(result, null);
	});

	test("returns null when both IMAP host and SMTP host are empty", () => {
		const result = computeSmtpAutoFill({
			imapHost: "",
			smtpHost: "",
		});
		assert.equal(result, null);
	});

	test("returns null when IMAP host is whitespace", () => {
		const result = computeSmtpAutoFill({
			imapHost: "   ",
			smtpHost: "",
		});
		assert.equal(result, null);
	});

	test("trims IMAP host before deriving SMTP host", () => {
		const result = computeSmtpAutoFill({
			imapHost: "  imap.example.com  ",
			smtpHost: "",
		});
		assert.equal(result?.smtpHost, "smtp.example.com");
	});
});

describe("accountIsMissingSmtp", () => {
	test("true when smtpHost is undefined", () => {
		assert.equal(accountIsMissingSmtp({}), true);
	});

	test("true when smtpHost is null", () => {
		assert.equal(accountIsMissingSmtp({ smtpHost: null }), true);
	});

	test("true when smtpHost is empty string", () => {
		assert.equal(accountIsMissingSmtp({ smtpHost: "" }), true);
	});

	test("true when smtpHost is whitespace", () => {
		assert.equal(accountIsMissingSmtp({ smtpHost: "   " }), true);
	});

	test("false when smtpHost is set", () => {
		assert.equal(accountIsMissingSmtp({ smtpHost: "smtp.example.com" }), false);
	});
});

describe("isAuthError", () => {
	for (const msg of [
		"AUTHENTICATIONFAILED",
		"535 5.7.8 Bad credentials",
		"Invalid login",
		"bad credential",
	]) {
		test(`true for "${msg}"`, () => {
			assert.equal(isAuthError(msg), true);
		});
	}

	test("false for a network error", () => {
		assert.equal(isAuthError("connect ETIMEDOUT 1.2.3.4:993"), false);
	});

	test("false for undefined", () => {
		assert.equal(isAuthError(undefined), false);
	});
});

describe("appendAppPasswordHint", () => {
	const hint = "iCloud requires an app-specific password.";

	test("appends the hint to an auth error", () => {
		const result = appendAppPasswordHint("Invalid login", hint);
		assert.equal(result, `Invalid login — ${hint}`);
	});

	test("leaves a non-auth error untouched", () => {
		assert.equal(
			appendAppPasswordHint("connect ETIMEDOUT", hint),
			"connect ETIMEDOUT",
		);
	});

	test("returns the message unchanged when there is no hint", () => {
		assert.equal(
			appendAppPasswordHint("Invalid login", undefined),
			"Invalid login",
		);
	});

	test("returns undefined when there is no message", () => {
		assert.equal(appendAppPasswordHint(undefined, hint), undefined);
	});
});
