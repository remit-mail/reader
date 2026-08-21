import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CanonicalMailboxRole, MailboxSpecialUse } from "@remit/domain-enums";
import {
	composeFolderRoleAppointmentLabelName,
	composeFolderRoleAppointmentName,
	meetsTrashAssurance,
	parseFolderRoleAppointmentLabelName,
	parseFolderRoleAppointmentName,
	type RoleMailboxCandidate,
	resolveConfirmedMailboxForRole,
	resolveMailboxForRole,
	resolveRoleForAccount,
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
	// #837: joining Trash to the leaf-name resolver made depth outrank the name,
	// so a top-level `Bin` beat `[Gmail]/Trash` and deletes landed in the wrong
	// folder. `bin` is no longer a hint — Gmail flags both \Trash — so the name
	// rule reaches `[Gmail]/Trash` and nothing reaches `Bin`.
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-bin", "Bin"),
		mailbox("mb-gmail-trash", "[Gmail]/Trash"),
	];

	it("proposes [Gmail]/Trash, never the folder called Bin", () => {
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, mailboxes)?.mailboxId,
			"mb-gmail-trash",
		);
	});

	it("resolves to whichever folder the user appointed", () => {
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

describe("resolveConfirmedMailboxForRole", () => {
	// What Empty Trash resolves through: an expunge may only touch a folder
	// somebody actually designated (audit #841).
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-deleted", "Deleted"),
		mailbox("mb-gmail-trash", "[Gmail]/Trash"),
	];

	it("refuses a folder that only matches by name", () => {
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, mailboxes),
			null,
		);
	});

	it("takes the appointment over the folder the name rule would have picked", () => {
		assert.equal(
			resolveConfirmedMailboxForRole(
				CanonicalMailboxRole.Trash,
				mailboxes,
				"mb-gmail-trash",
			)?.mailboxId,
			"mb-gmail-trash",
		);
	});

	it("takes the server flag when nothing is appointed", () => {
		const flagged = [
			mailbox("mb-deleted", "Deleted"),
			mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, flagged)
				?.mailboxId,
			"mb-trash",
		);
	});
});

describe("resolveRoleForAccount", () => {
	it("answers none when nothing names a Trash folder", () => {
		// #887 Done item 4: an account whose folders happen to include a Dutch
		// "Prullenbak" has no Trash reader may act on — no flag, no appointment,
		// and "prullenbak" is not a hint.
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-werk", "Werk"),
			mailbox("mb-prullenbak", "Prullenbak"),
		];
		assert.deepEqual(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, mailboxes),
			{ kind: "none" },
		);
	});

	it("proposes a folder named Trash, and that is not enough to empty it", () => {
		// #887 Done item 1: the name is a guess. It files a delete somewhere
		// retrievable; it never authorises an expunge.
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-werk", "Werk"),
			mailbox("mb-trash", "Trash"),
		];
		const resolution = resolveRoleForAccount(
			CanonicalMailboxRole.Trash,
			mailboxes,
		);
		assert.deepEqual(resolution, {
			kind: "proposed",
			mailbox: mailboxes[2],
		});
		assert.equal(meetsTrashAssurance(resolution, "confirmed"), false);
		assert.equal(meetsTrashAssurance(resolution, "resolved"), true);
	});

	it("names the appointment that went stale, and what took its place", () => {
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		const resolution = resolveRoleForAccount(
			CanonicalMailboxRole.Trash,
			mailboxes,
			"mb-rubbish-deleted-by-apple-mail",
		);
		assert.deepEqual(resolution, {
			kind: "appointment_stale",
			appointedMailboxId: "mb-rubbish-deleted-by-apple-mail",
			fallback: { kind: "flagged", mailbox: mailboxes[1] },
		});
		assert.equal(meetsTrashAssurance(resolution, "confirmed"), false);
		assert.equal(meetsTrashAssurance(resolution, "resolved"), false);
	});

	it("tags the appointment the user made and the flag the server set apart", () => {
		const mailboxes = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
		];
		assert.equal(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, mailboxes).kind,
			"flagged",
		);
		assert.equal(
			resolveRoleForAccount(CanonicalMailboxRole.Trash, mailboxes, "mb-inbox")
				.kind,
			"appointed",
		);
		assert.equal(
			resolveRoleForAccount(CanonicalMailboxRole.Inbox, mailboxes).kind,
			"reserved",
		);
	});
});

describe("the adapters over resolveRoleForAccount", () => {
	const mailboxes = [
		mailbox("mb-inbox", "INBOX"),
		mailbox("mb-trash", "[Gmail]/Trash", [MailboxSpecialUse.Trash]),
	];

	it("withholds a stale appointment's fallback from the confirmed answer only", () => {
		// A vanished appointment is not confirmation of anything, so the expunge
		// gate sees nothing. Filing mail still works: the fallback is a fine place
		// to put a message the user can move back.
		assert.equal(
			resolveConfirmedMailboxForRole(
				CanonicalMailboxRole.Trash,
				mailboxes,
				"mb-gone",
			),
			null,
		);
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, mailboxes, "mb-gone")
				?.mailboxId,
			"mb-trash",
		);
	});

	it("keeps a stale appointment on the flag, never on a folder named like one", () => {
		// The confirmed adapter is not built on top of the other one: were it,
		// null-on-stale would drop the seven non-Trash roles past their
		// SPECIAL-USE flag and into the name hint, and a folder somebody called
		// "Sent" would start collecting this account's sent mail.
		const sent = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-sent-copy", "Sent"),
			mailbox("mb-sent", "[Gmail]/Sent Mail", [MailboxSpecialUse.Sent]),
		];
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Sent, sent, "mb-gone")
				?.mailboxId,
			"mb-sent",
		);
	});

	it("keeps the name guess out of the confirmed answer", () => {
		const unflagged = [
			mailbox("mb-inbox", "INBOX"),
			mailbox("mb-bak", "Trash"),
		];
		assert.equal(
			resolveConfirmedMailboxForRole(CanonicalMailboxRole.Trash, unflagged),
			null,
		);
		assert.equal(
			resolveMailboxForRole(CanonicalMailboxRole.Trash, unflagged)?.mailboxId,
			"mb-bak",
		);
	});
});

describe("the appointment name and its label sibling", () => {
	it("never lets the label row parse as an appointment", () => {
		// The label is display only. If the appointment parser matched it, a path
		// string would be read back as a mailboxId and resolution would follow it.
		const label = composeFolderRoleAppointmentLabelName(
			"acc-1",
			CanonicalMailboxRole.Trash,
		);
		assert.equal(parseFolderRoleAppointmentName(label), undefined);
		assert.deepEqual(parseFolderRoleAppointmentLabelName(label), {
			accountId: "acc-1",
			role: CanonicalMailboxRole.Trash,
		});
	});

	it("never lets an appointment row parse as a label", () => {
		const appointment = composeFolderRoleAppointmentName(
			"acc-1",
			CanonicalMailboxRole.Trash,
		);
		assert.equal(parseFolderRoleAppointmentLabelName(appointment), undefined);
		assert.deepEqual(parseFolderRoleAppointmentName(appointment), {
			accountId: "acc-1",
			role: CanonicalMailboxRole.Trash,
		});
	});
});
