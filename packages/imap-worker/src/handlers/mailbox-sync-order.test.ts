import assert from "node:assert";
import { describe, it } from "node:test";
import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	type MailboxSyncOrderEntry,
	mailboxSyncPriority,
	orderMailboxesForSync,
} from "./mailbox-sync-order.js";

const mailbox = (
	fullPath: string,
	specialUse?: readonly string[],
): MailboxSyncOrderEntry => ({
	mailboxId: `id-${fullPath}`,
	fullPath,
	specialUse,
});

describe("orderMailboxesForSync", () => {
	it("orders INBOX first, Sent/Drafts next, Junk and Trash last", () => {
		const mailboxes = [
			mailbox("INBOX/Spam", [MailboxSpecialUse.Junk]),
			mailbox("Trash", [MailboxSpecialUse.Trash]),
			mailbox("Projects"),
			mailbox("INBOX"),
			mailbox("Sent", [MailboxSpecialUse.Sent]),
			mailbox("Drafts", [MailboxSpecialUse.Drafts]),
		];

		const ordered = orderMailboxesForSync(mailboxes).map((m) => m.fullPath);

		assert.deepStrictEqual(ordered, [
			"INBOX",
			"Sent",
			"Drafts",
			"Projects",
			"INBOX/Spam",
			"Trash",
		]);
	});

	it("places INBOX ahead of an alphabetically-earlier Junk folder", () => {
		const ordered = orderMailboxesForSync([
			mailbox("Bulk", [MailboxSpecialUse.Junk]),
			mailbox("INBOX"),
		]).map((m) => m.fullPath);

		assert.deepStrictEqual(ordered, ["INBOX", "Bulk"]);
	});

	it("is deterministic: ties break alphabetically by fullPath", () => {
		const ordered = orderMailboxesForSync([
			mailbox("Work"),
			mailbox("Archive", [MailboxSpecialUse.Archive]),
			mailbox("Newsletters"),
		]).map((m) => m.fullPath);

		assert.deepStrictEqual(ordered, ["Archive", "Newsletters", "Work"]);
	});

	it("does not mutate the input array", () => {
		const input = [
			mailbox("Trash", [MailboxSpecialUse.Trash]),
			mailbox("INBOX"),
		];
		const before = input.map((m) => m.fullPath);
		orderMailboxesForSync(input);
		assert.deepStrictEqual(
			input.map((m) => m.fullPath),
			before,
		);
	});

	it("treats INBOX case-insensitively", () => {
		assert.strictEqual(mailboxSyncPriority(mailbox("inbox")), 0);
		assert.strictEqual(mailboxSyncPriority(mailbox("Inbox")), 0);
	});

	it("de-prioritises a folder carrying both a leading and a Junk flag", () => {
		assert.ok(
			mailboxSyncPriority(
				mailbox("Weird", [MailboxSpecialUse.Sent, MailboxSpecialUse.Junk]),
			) > mailboxSyncPriority(mailbox("Plain")),
		);
	});

	it("gives unflagged user folders the normal priority", () => {
		assert.strictEqual(
			mailboxSyncPriority(mailbox("Projects")),
			mailboxSyncPriority(mailbox("Personal", [])),
		);
	});
});
