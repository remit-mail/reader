import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMailboxByLeafName } from "./mailbox-name.js";

const JUNK_NAMES = ["junk", "spam", "junk e-mail", "junk email", "bulk mail"];

const mailbox = (
	mailboxId: string,
	fullPath: string,
	hierarchyDelimiter = "/",
) => ({ mailboxId, fullPath, hierarchyDelimiter });

describe("resolveMailboxByLeafName", () => {
	it("resolves a Junk folder nested under INBOX", () => {
		// The layout that broke report-spam's name fallback: an INBOX-prefixed
		// namespace where Junk is `INBOX/Spam`, which never equals "spam".
		const found = resolveMailboxByLeafName(
			[
				mailbox("m-inbox", "INBOX"),
				mailbox("m-spam", "INBOX/Spam"),
				mailbox("m-sent", "INBOX/Sent"),
			],
			JUNK_NAMES,
		);
		assert.equal(found?.mailboxId, "m-spam");
	});

	it("resolves under a non-slash delimiter and a non-INBOX prefix", () => {
		const found = resolveMailboxByLeafName(
			[mailbox("m-junk", "Mail.Junk E-mail", ".")],
			JUNK_NAMES,
		);
		assert.equal(found?.mailboxId, "m-junk");
	});

	it("treats a flat namespace with no delimiter as its own leaf", () => {
		const found = resolveMailboxByLeafName(
			[mailbox("m-junk", "Junk", "")],
			JUNK_NAMES,
		);
		assert.equal(found?.mailboxId, "m-junk");
	});

	it("prefers the shallowest match over a deeper one", () => {
		const found = resolveMailboxByLeafName(
			[
				mailbox("m-buried", "Archive/2019/Spam"),
				mailbox("m-real", "INBOX/Junk"),
			],
			JUNK_NAMES,
		);
		assert.equal(found?.mailboxId, "m-real");
	});

	it("prefers the better name at equal depth", () => {
		const found = resolveMailboxByLeafName(
			[mailbox("m-bulk", "INBOX/Bulk Mail"), mailbox("m-junk", "INBOX/Junk")],
			JUNK_NAMES,
		);
		assert.equal(found?.mailboxId, "m-junk");
	});

	it("answers null when no folder carries a conventional name", () => {
		const found = resolveMailboxByLeafName(
			[mailbox("m-inbox", "INBOX"), mailbox("m-work", "INBOX/Work")],
			JUNK_NAMES,
		);
		assert.equal(found, null);
	});
});
