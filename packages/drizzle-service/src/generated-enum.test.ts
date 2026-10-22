import assert from "node:assert/strict";
import { test } from "node:test";
import { MailboxAttribute, MessageSystemFlag } from "@remit/domain-enums";

test("the generated enums keep the backslash IMAP puts on a system flag and a mailbox attribute", () => {
	assert.equal(MessageSystemFlag.Seen, "\\Seen");
	assert.equal(MailboxAttribute.NoSelect, "\\Noselect");
});
