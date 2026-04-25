import assert from "node:assert";
import { describe, test } from "node:test";
import {
	getMailboxDisplayName,
	getMailboxPriority,
	isSystemMailbox,
	NON_SYSTEM_PRIORITY,
} from "./mailbox-order.js";

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
