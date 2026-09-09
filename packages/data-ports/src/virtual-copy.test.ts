import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MailboxItem } from "./types.js";
import { isVirtualCopyMailbox } from "./virtual-copy.js";

const mailbox = (fullPath: string, specialUse?: string[]): MailboxItem =>
	({
		mailboxId: `mbx-${fullPath}`,
		fullPath,
		...(specialUse ? { specialUse } : {}),
	}) as MailboxItem;

describe("which folders hold a second copy of mail that lives elsewhere", () => {
	it("reads the special-use the server advertises", () => {
		assert.equal(isVirtualCopyMailbox(mailbox("Everything", ["All"])), true);
		assert.equal(isVirtualCopyMailbox(mailbox("Pinned", ["Flagged"])), true);
		assert.equal(isVirtualCopyMailbox(mailbox("Urgent", ["Important"])), true);
	});

	it("falls back to the well-known path when the server advertises nothing", () => {
		assert.equal(isVirtualCopyMailbox(mailbox("[Gmail]/All Mail")), true);
		assert.equal(isVirtualCopyMailbox(mailbox("[gmail]/starred")), true);
	});

	it("matches the whole path, so a folder of the user's own is real mail", () => {
		assert.equal(isVirtualCopyMailbox(mailbox("Starred ideas")), false);
		assert.equal(isVirtualCopyMailbox(mailbox("[Gmail]/All Mail/2024")), false);
	});

	it("reads an ordinary folder as the place mail lives", () => {
		assert.equal(isVirtualCopyMailbox(mailbox("INBOX")), false);
		assert.equal(isVirtualCopyMailbox(mailbox("Rubbish", ["Junk"])), false);
	});
});
