import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { MailConnectionError } from "@remit/mailbox-service";
import { imapFailureKind } from "./failure-kind.js";

describe("imapFailureKind", () => {
	it("counts an IMAP authentication rejection as auth", () => {
		assert.equal(
			imapFailureKind(
				new MailConnectionError("auth", "IMAP authentication failed"),
			),
			"auth",
		);
	});

	it("counts a token refresh that cannot mint credentials as auth", () => {
		assert.equal(
			imapFailureKind(
				new RefreshTokenError({
					kind: "reauth-required",
					code: "invalid_grant",
				}),
			),
			"auth",
		);
	});

	it("keeps a network failure apart from an auth failure", () => {
		assert.equal(
			imapFailureKind(
				new MailConnectionError("network", "IMAP connection failed: ETIMEDOUT"),
			),
			"network",
		);
	});

	it("classifies anything else as other", () => {
		assert.equal(imapFailureKind(new Error("bad cursor")), "other");
		assert.equal(imapFailureKind(undefined), "other");
	});
});
