import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CanonicalMailboxRole, MailboxSpecialUse } from "@remit/domain-enums";
import {
	type RoleMailboxCandidate,
	resolveMailboxForRole,
} from "./folder-role.js";

const mailbox = (
	mailboxId: string,
	fullPath: string,
	specialUse: readonly string[] = [],
	hierarchyDelimiter = "/",
): RoleMailboxCandidate => ({
	mailboxId,
	fullPath,
	hierarchyDelimiter,
	specialUse,
});

describe("resolveMailboxForRole precedence", () => {
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-spam", "INBOX/Spam"),
		mailbox("mb-junk", "Junk", [MailboxSpecialUse.Junk]),
		mailbox("mb-project", "INBOX/Project X"),
	];

	it("puts the user's appointment above both the flag and the name", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Junk, mailboxes, "mb-project")
				?.mailboxId,
			"mb-project",
		);
	});

	it("takes the server's SPECIAL-USE flag when nothing is appointed", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Junk, mailboxes)?.mailboxId,
			"mb-junk",
		);
	});

	it("falls back to the name only when no flag is present", () => {
		const unflagged = mailboxes.filter((m) => m.mailboxId !== "mb-junk");
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Junk, unflagged)?.mailboxId,
			"mb-spam",
		);
	});

	it("reads the leaf against the mailbox's own delimiter, not a hardcoded slash", () => {
		const dotted = [
			mailbox("mb-inbox", "INBOX", [], "."),
			mailbox("mb-trash", "INBOX.Deleted Items", [], "."),
		];
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, dotted)?.mailboxId,
			"mb-trash",
		);
	});

	it("matches the reserved INBOX name for Inbox", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Inbox, mailboxes)?.mailboxId,
			"mb-inbox",
		);
	});

	it("returns null rather than guessing when nothing matches", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Archive, mailboxes),
			null,
		);
	});

	it("re-proposes when the appointment names a mailbox that is gone", () => {
		assert.equal(
			resolveMailboxForRole(
				CanonicalMailboxRole.Junk,
				mailboxes,
				"mb-deleted-last-week",
			)?.mailboxId,
			"mb-junk",
		);
	});
});

describe("resolveMailboxForRole on [Gmail]/Trash beside a top-level Bin", () => {
	// #837: the name proposal ranks depth above the name, so the top-level `Bin`
	// outranks `[Gmail]/Trash` and a delete would land in the wrong folder. The
	// proposal is a guess, and the user's appointment settles it either way.
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-bin", "Bin"),
		mailbox("mb-gmail-trash", "[Gmail]/Trash"),
	];

	it("resolves to whichever folder the user appointed", () => {
		assert.equal(
			resolveMailboxForRole(
				CanonicalMailboxRole.Trash,
				mailboxes,
				"mb-gmail-trash",
			)?.mailboxId,
			"mb-gmail-trash",
		);
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, mailboxes, "mb-bin")
				?.mailboxId,
			"mb-bin",
		);
	});

	it("still takes the SPECIAL-USE flag over the name when nothing is appointed", () => {
		const flagged = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-bin", "Bin"),
			mailbox("mb-gmail-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, flagged)?.mailboxId,
			"mb-gmail-trash",
		);
	});
});
