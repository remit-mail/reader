import assert from "node:assert";
import { describe, test } from "node:test";
import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	filterDuplicateSpecialUse,
	getMailboxDisplayLabel,
	getMailboxDisplayName,
	getMailboxKind,
	getMailboxPriority,
	isSystemMailbox,
	NON_SYSTEM_PRIORITY,
	shouldShowUnreadBadge,
} from "./mailbox-order.js";

interface TestMailbox {
	mailboxId: string;
	fullPath: string;
	specialUse?: readonly string[];
}

const mb = (
	id: string,
	fullPath: string,
	specialUse?: readonly string[],
): TestMailbox => ({ mailboxId: id, fullPath, specialUse });

describe("getMailboxPriority", () => {
	test("INBOX has the highest priority", () => {
		assert.strictEqual(getMailboxPriority("INBOX"), 0);
		assert.strictEqual(getMailboxPriority("inbox"), 0);
	});

	test("Drafts come before Sent", () => {
		assert.ok(getMailboxPriority("Drafts") < getMailboxPriority("Sent"));
		assert.ok(getMailboxPriority("Draft") < getMailboxPriority("Sent Mail"));
	});

	test("Trash and aliases sort to the same group", () => {
		const trash = getMailboxPriority("Trash");
		assert.strictEqual(getMailboxPriority("Bin"), trash);
		assert.strictEqual(getMailboxPriority("Deleted"), trash);
		assert.strictEqual(getMailboxPriority("Deleted Items"), trash);
	});

	test("Spam and Junk sort to the same group", () => {
		assert.strictEqual(getMailboxPriority("Spam"), getMailboxPriority("Junk"));
	});

	test("Standard system folders are ordered Inbox, Drafts, Sent, Archive, Spam, Trash", () => {
		const order = ["INBOX", "Drafts", "Sent", "Archive", "Spam", "Trash"].map(
			(p) => getMailboxPriority(p),
		);
		for (let i = 1; i < order.length; i++) {
			assert.ok(
				order[i - 1] < order[i],
				`Expected ascending priorities, got ${order.join(", ")}`,
			);
		}
	});

	test("Custom folders get the lowest priority", () => {
		assert.strictEqual(getMailboxPriority("Receipts"), NON_SYSTEM_PRIORITY);
		assert.strictEqual(getMailboxPriority("Project X"), NON_SYSTEM_PRIORITY);
	});

	test("Custom folders containing system folder names are not treated as system", () => {
		assert.strictEqual(
			getMailboxPriority("Archived 2024"),
			NON_SYSTEM_PRIORITY,
		);
		assert.strictEqual(
			getMailboxPriority("old-inbox-backup"),
			NON_SYSTEM_PRIORITY,
		);
		assert.strictEqual(getMailboxPriority("Send Later"), NON_SYSTEM_PRIORITY);
	});

	test("Nested mailboxes are not treated as system folders", () => {
		assert.strictEqual(
			getMailboxPriority("INBOX/Subfolder"),
			NON_SYSTEM_PRIORITY,
		);
		assert.strictEqual(
			getMailboxPriority("Folders/Drafts"),
			NON_SYSTEM_PRIORITY,
		);
	});

	test("namespace-nested system folders sort canonically (#962)", () => {
		assert.strictEqual(
			getMailboxPriority("INBOX/Drafts"),
			getMailboxPriority("Drafts"),
		);
		assert.strictEqual(
			getMailboxPriority("INBOX/Sent"),
			getMailboxPriority("Sent"),
		);
		assert.ok(
			getMailboxPriority("INBOX/Drafts") < getMailboxPriority("INBOX/Sent"),
		);
		assert.strictEqual(
			getMailboxPriority("INBOX/Nieuwsbrieven"),
			NON_SYSTEM_PRIORITY,
		);
	});
});

describe("isSystemMailbox", () => {
	test("identifies system mailboxes", () => {
		assert.strictEqual(isSystemMailbox("INBOX"), true);
		assert.strictEqual(isSystemMailbox("Drafts"), true);
		assert.strictEqual(isSystemMailbox("Sent"), true);
		assert.strictEqual(isSystemMailbox("Trash"), true);
	});

	test("rejects custom mailboxes", () => {
		assert.strictEqual(isSystemMailbox("Receipts"), false);
		assert.strictEqual(isSystemMailbox("INBOX/Sub"), false);
	});
});

describe("getMailboxDisplayName", () => {
	test("returns the leaf name", () => {
		assert.strictEqual(getMailboxDisplayName("INBOX"), "INBOX");
		assert.strictEqual(getMailboxDisplayName("Folders/Work"), "Work");
		assert.strictEqual(
			getMailboxDisplayName("Folders/Work/Reports"),
			"Reports",
		);
	});
});

describe("filterDuplicateSpecialUse", () => {
	test("collapses Sent + Sent Messages into a single canonical Sent (issue #178)", () => {
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("b", "Sent"),
			mb("c", "Sent Messages"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "Sent"],
		);
	});

	test("keeps Sent Messages when Sent is absent", () => {
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("c", "Sent Messages"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "Sent Messages"],
		);
	});

	test("when [Gmail]/Sent Mail exists, drops top-level Sent in favour of it", () => {
		// Gmail-namespaced sent folder is the canonical one for Gmail accounts;
		// the auto-created top-level alias gets pruned.
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("b", "Sent"),
			mb("c", "[Gmail]/Sent Mail"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "[Gmail]/Sent Mail"],
		);
	});

	test("preserves custom labels untouched", () => {
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("b", "Sent"),
			mb("c", "Receipts"),
			mb("d", "Project X"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "Sent", "Receipts", "Project X"],
		);
	});

	test("collapses Trash and Bin to canonical Trash", () => {
		const result = filterDuplicateSpecialUse([
			mb("a", "Trash"),
			mb("b", "Bin"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["Trash"],
		);
	});

	test("collapses Outlook NL Sent triplet by SPECIAL-USE flag (#194)", () => {
		// Outlook with Dutch locale exposes three sent-like folders, only one
		// of which carries the IMAP \Sent attribute. The flagged one wins.
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("b", "Sent"),
			mb("c", "Sent Messages"),
			mb("d", "Verzonden items", [MailboxSpecialUse.Sent]),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "Verzonden items"],
		);
	});

	test("preserves Nieuwsbrieven (a real user folder) when only Spam has SPECIAL-USE", () => {
		// Issue #194 explicitly notes Nieuwsbrieven (Newsletters) is a real
		// user folder, not a junk synonym — it must survive dedup even though
		// the account is otherwise localized.
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("b", "Spam", [MailboxSpecialUse.Junk]),
			mb("c", "Nieuwsbrieven"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "Spam", "Nieuwsbrieven"],
		);
	});

	test("preserves user folder named like a system folder under a parent", () => {
		// `Personal/Sent` is NOT a system folder — it's a user-defined folder
		// whose leaf happens to be `Sent`. It must be preserved.
		const result = filterDuplicateSpecialUse([
			mb("a", "INBOX"),
			mb("b", "Sent", [MailboxSpecialUse.Sent]),
			mb("c", "Personal/Sent"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["INBOX", "Sent", "Personal/Sent"],
		);
	});

	test("flagged mailbox always wins over an English-named twin (#194)", () => {
		const result = filterDuplicateSpecialUse([
			mb("a", "Sent"),
			mb("b", "Concepten", [MailboxSpecialUse.Drafts]),
			mb("c", "Drafts"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath).sort(),
			["Concepten", "Sent"].sort(),
		);
	});

	test("a mailbox carrying the flag at any depth is treated as the canonical", () => {
		// Some servers tuck the real Trash inside a namespace prefix. If it
		// carries \Trash, it's authoritative.
		const result = filterDuplicateSpecialUse([
			mb("a", "Trash"),
			mb("b", "[Mail]/Trash", [MailboxSpecialUse.Trash]),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			["[Mail]/Trash"],
		);
	});

	test("collapses Hostnet INBOX/-namespace sent and drafts twins (#962)", () => {
		// Hostnet nests everything under "INBOX/" and only Spam carries a flag.
		// The unflagged English/Dutch sent + drafts twins collapse to one each,
		// while the real "Nieuwsbrieven" user folder survives.
		const result = filterDuplicateSpecialUse([
			mb("inbox", "INBOX"),
			mb("spam", "INBOX/Spam", [MailboxSpecialUse.Junk]),
			mb("sent", "INBOX/Sent"),
			mb("sentmsgs", "INBOX/Sent Messages"),
			mb("drafts", "INBOX/Drafts"),
			mb("concepten", "INBOX/Concepten"),
			mb("news", "INBOX/Nieuwsbrieven"),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.fullPath),
			[
				"INBOX",
				"INBOX/Spam",
				"INBOX/Sent",
				"INBOX/Drafts",
				"INBOX/Nieuwsbrieven",
			],
		);
	});
});

describe("getMailboxKind", () => {
	test("returns special-use group when flag present", () => {
		assert.strictEqual(
			getMailboxKind("Verzonden items", [MailboxSpecialUse.Sent]),
			"sent",
		);
		assert.strictEqual(
			getMailboxKind("Concepten", [MailboxSpecialUse.Drafts]),
			"drafts",
		);
	});

	test("falls back to English alias when no flag", () => {
		assert.strictEqual(getMailboxKind("Sent"), "sent");
		assert.strictEqual(getMailboxKind("INBOX"), "inbox");
		assert.strictEqual(getMailboxKind("Trash"), "trash");
	});

	test("returns null for user folders", () => {
		assert.strictEqual(getMailboxKind("Receipts"), null);
		assert.strictEqual(getMailboxKind("Nieuwsbrieven"), null);
		assert.strictEqual(getMailboxKind("Personal/Stuff"), null);
	});

	test("matches the bare enum-name Junk flag (#962)", () => {
		assert.strictEqual(
			getMailboxKind("INBOX/Spam", [MailboxSpecialUse.Junk]),
			"junk",
		);
		assert.strictEqual(getMailboxKind("Spam", ["Junk"]), "junk");
	});

	test("recognizes system roles for folders nested under the INBOX namespace (#962)", () => {
		assert.strictEqual(getMailboxKind("INBOX/Sent"), "sent");
		assert.strictEqual(getMailboxKind("INBOX/Drafts"), "drafts");
		assert.strictEqual(getMailboxKind("INBOX/Archive"), "archive");
		assert.strictEqual(getMailboxKind("INBOX/Deleted Messages"), "trash");
		assert.strictEqual(getMailboxKind("INBOX"), "inbox");
	});

	test("keeps real user subfolders under the namespace as custom (#962)", () => {
		assert.strictEqual(getMailboxKind("INBOX/Nieuwsbrieven"), null);
	});

	test("does not promote a system-named folder under a non-namespace parent (#962)", () => {
		assert.strictEqual(getMailboxKind("Personal/Sent"), null);
		assert.strictEqual(getMailboxKind("Folders/Drafts"), null);
		// Deeper than one level under the namespace root is custom too.
		assert.strictEqual(getMailboxKind("INBOX/Work/Sent"), null);
	});

	test("preserves existing [Gmail]/Sent Mail behaviour (kind stays null) (#962)", () => {
		assert.strictEqual(getMailboxKind("[Gmail]/Sent Mail"), null);
	});

	test("matches a top-level system folder by name", () => {
		assert.strictEqual(getMailboxKind("Sent"), "sent");
	});
});

describe("getMailboxDisplayLabel", () => {
	const t = (key: string, fallback: string) =>
		key === "sidebar.sent"
			? "Verzonden"
			: key === "sidebar.inbox"
				? "Postvak IN"
				: fallback;

	test("translates system folder via the supplied translator", () => {
		assert.strictEqual(
			getMailboxDisplayLabel("Verzonden items", [MailboxSpecialUse.Sent], t),
			"Verzonden",
		);
		assert.strictEqual(
			getMailboxDisplayLabel("INBOX", undefined, t),
			"Postvak IN",
		);
	});

	test("returns server name verbatim for user folders", () => {
		assert.strictEqual(
			getMailboxDisplayLabel("Nieuwsbrieven", undefined, t),
			"Nieuwsbrieven",
		);
		assert.strictEqual(
			getMailboxDisplayLabel("Folders/Work", undefined, t),
			"Work",
		);
	});

	test("falls back to leaf name when no translator available", () => {
		assert.strictEqual(
			getMailboxDisplayLabel("Verzonden items", [MailboxSpecialUse.Sent]),
			"Verzonden items",
		);
	});
});

describe("shouldShowUnreadBadge", () => {
	test("hides badge on Sent / Drafts / Trash regardless of locale (#195)", () => {
		assert.strictEqual(shouldShowUnreadBadge("Sent"), false);
		assert.strictEqual(
			shouldShowUnreadBadge("Verzonden items", [MailboxSpecialUse.Sent]),
			false,
		);
		assert.strictEqual(shouldShowUnreadBadge("Drafts"), false);
		assert.strictEqual(
			shouldShowUnreadBadge("Concepten", [MailboxSpecialUse.Drafts]),
			false,
		);
		assert.strictEqual(shouldShowUnreadBadge("Trash"), false);
		assert.strictEqual(
			shouldShowUnreadBadge("Prullenbak", [MailboxSpecialUse.Trash]),
			false,
		);
	});

	test("shows badge on INBOX, Junk, and user folders (#195)", () => {
		assert.strictEqual(shouldShowUnreadBadge("INBOX"), true);
		assert.strictEqual(shouldShowUnreadBadge("Spam"), true);
		assert.strictEqual(
			shouldShowUnreadBadge("Junk", [MailboxSpecialUse.Junk]),
			true,
		);
		assert.strictEqual(shouldShowUnreadBadge("Nieuwsbrieven"), true);
		assert.strictEqual(shouldShowUnreadBadge("Receipts"), true);
	});
});

describe("priority sorting honors SPECIAL-USE flags (#194)", () => {
	test("a Drafts-flagged mailbox sorts ahead of a Sent-flagged one", () => {
		const drafts = getMailboxPriority("Concepten", [MailboxSpecialUse.Drafts]);
		const sent = getMailboxPriority("Verzonden items", [
			MailboxSpecialUse.Sent,
		]);
		assert.ok(drafts < sent);
	});

	test("isSystemMailbox is true for any flagged mailbox, regardless of name", () => {
		assert.strictEqual(
			isSystemMailbox("Verzonden items", [MailboxSpecialUse.Sent]),
			true,
		);
		assert.strictEqual(
			isSystemMailbox("Прибрана пошта", [MailboxSpecialUse.Trash]),
			true,
		);
	});
});
