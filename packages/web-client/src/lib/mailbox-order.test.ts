import assert from "node:assert";
import { describe, test } from "node:test";
import {
	filterDuplicateSpecialUse,
	getMailboxDisplayName,
	getMailboxPriority,
	isSystemMailbox,
	NON_SYSTEM_PRIORITY,
} from "./mailbox-order.js";

const mb = (id: string, fullPath: string) => ({ mailboxId: id, fullPath });

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
			getMailboxPriority,
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
});
