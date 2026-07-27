import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { SmtpConnectionError } from "@remit/smtp-service";
import { smtpFailureKind } from "./failure-kind.js";

describe("smtpFailureKind", () => {
	it("counts an SMTP authentication rejection as auth", () => {
		assert.equal(
			smtpFailureKind(new SmtpConnectionError("auth", "535 bad credentials")),
			"auth",
		);
	});

	it("counts a token refresh that cannot mint credentials as auth", () => {
		assert.equal(
			smtpFailureKind(
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
			smtpFailureKind(new SmtpConnectionError("network", "ECONNREFUSED")),
			"network",
		);
	});

	it("classifies anything else as other", () => {
		assert.equal(smtpFailureKind(new Error("nodemailer blew up")), "other");
		assert.equal(smtpFailureKind("not an error"), "other");
	});
});
