import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	resolveSentMailboxByName,
	type SentMailboxCandidate,
} from "./sent-mailbox.js";

const mailbox = (
	fullPath: string,
	hierarchyDelimiter = "/",
): SentMailboxCandidate => ({
	mailboxId: `mbx-${fullPath}`,
	fullPath,
	hierarchyDelimiter,
});

describe("resolveSentMailboxByName", () => {
	it("finds a top-level Sent folder", () => {
		const found = resolveSentMailboxByName([mailbox("INBOX"), mailbox("Sent")]);

		assert.equal(found?.fullPath, "Sent");
	});

	it("finds a Sent folder nested under INBOX", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX"),
			mailbox("INBOX/Archive"),
			mailbox("INBOX/Sent"),
		]);

		assert.equal(found?.fullPath, "INBOX/Sent");
	});

	it("finds a nested Sent folder under a non-INBOX prefix with a non-slash delimiter", () => {
		const found = resolveSentMailboxByName([
			mailbox("Mail.Drafts", "."),
			mailbox("Mail.Sent Items", "."),
		]);

		assert.equal(found?.fullPath, "Mail.Sent Items");
	});

	it("finds the Gmail Sent folder by its leaf name", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX"),
			mailbox("[Gmail]/All Mail"),
			mailbox("[Gmail]/Sent Mail"),
		]);

		assert.equal(found?.fullPath, "[Gmail]/Sent Mail");
	});

	it("prefers the shallowest folder when several leaves match", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX/Clients/Sent"),
			mailbox("INBOX/Sent"),
		]);

		assert.equal(found?.fullPath, "INBOX/Sent");
	});

	it("prefers the plain Sent name over the longer variants", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX/Sent Messages"),
			mailbox("INBOX/Sent"),
		]);

		assert.equal(found?.fullPath, "INBOX/Sent");
	});

	it("matches the leaf regardless of case", () => {
		const found = resolveSentMailboxByName([mailbox("INBOX.sent items", ".")]);

		assert.equal(found?.fullPath, "INBOX.sent items");
	});

	it("does not match a folder that merely starts with a Sent name", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX/Sent Archive 2024"),
			mailbox("INBOX/Sentinel"),
		]);

		assert.equal(found, null);
	});

	it("prefers a shallower Sent over a deeper better-named one", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX.Sent Items", "."),
			mailbox("INBOX.Trash.Sent", "."),
		]);

		assert.equal(found?.fullPath, "INBOX.Sent Items");
	});

	it("resolves a flat namespace that reports no delimiter at all", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX", ""),
			mailbox("Sent", ""),
		]);

		assert.equal(found?.fullPath, "Sent");
	});

	it("returns null when the account has no Sent folder", () => {
		const found = resolveSentMailboxByName([
			mailbox("INBOX"),
			mailbox("INBOX/Trash"),
		]);

		assert.equal(found, null);
	});
});
