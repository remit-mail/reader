import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AccountMailboxes,
	buildResultFolderIndex,
	resolveResultFolder,
} from "./result-folder";

const account = (
	appointments: { role: string; mailboxId: string }[],
	mailboxes: { mailboxId: string; fullPath: string }[],
): AccountMailboxes =>
	({
		folderAppointments: appointments,
		mailboxes,
	}) as unknown as AccountMailboxes;

describe("buildResultFolderIndex", () => {
	it("maps a mailbox to its appointed role and provider path", () => {
		const index = buildResultFolderIndex([
			account(
				[{ role: "Junk", mailboxId: "mb-junk" }],
				[
					{ mailboxId: "mb-junk", fullPath: "Bulk Mail" },
					{ mailboxId: "mb-work", fullPath: "Projects/Bookkeeping" },
				],
			),
		]);

		assert.deepEqual(index.get("mb-junk"), {
			role: "junk",
			providerPath: "Bulk Mail",
		});
		assert.deepEqual(index.get("mb-work"), {
			providerPath: "Projects/Bookkeeping",
		});
	});

	it("keeps every account's mailboxes", () => {
		const index = buildResultFolderIndex([
			account(
				[{ role: "Inbox", mailboxId: "a-inbox" }],
				[{ mailboxId: "a-inbox", fullPath: "INBOX" }],
			),
			account(
				[{ role: "Inbox", mailboxId: "b-inbox" }],
				[{ mailboxId: "b-inbox", fullPath: "INBOX" }],
			),
		]);

		assert.equal(index.get("a-inbox")?.role, "inbox");
		assert.equal(index.get("b-inbox")?.role, "inbox");
	});
});

describe("resolveResultFolder", () => {
	const index = buildResultFolderIndex([
		account(
			[
				{ role: "Inbox", mailboxId: "mb-inbox" },
				{ role: "All", mailboxId: "mb-all" },
				{ role: "Junk", mailboxId: "mb-junk" },
			],
			[
				{ mailboxId: "mb-inbox", fullPath: "INBOX" },
				{ mailboxId: "mb-all", fullPath: "[Gmail]/All Mail" },
				{ mailboxId: "mb-junk", fullPath: "[Gmail]/Spam" },
			],
		),
	]);

	it("skips a virtual folder for one that names a real place", () => {
		assert.deepEqual(resolveResultFolder(index, ["mb-all", "mb-inbox"]), {
			mailboxId: "mb-inbox",
			folder: { role: "inbox", providerPath: "INBOX" },
		});
	});

	it("resolves Spam by its appointed role, not its path", () => {
		assert.equal(resolveResultFolder(index, ["mb-junk"]).folder?.role, "junk");
	});

	it("falls back to the first id when none names a real place", () => {
		assert.deepEqual(resolveResultFolder(index, ["mb-all"]), {
			mailboxId: "mb-all",
			folder: { role: "all", providerPath: "[Gmail]/All Mail" },
		});
	});

	it("returns the id but no folder when the mailbox is unknown", () => {
		assert.deepEqual(resolveResultFolder(index, ["mb-gone"]), {
			mailboxId: "mb-gone",
		});
	});

	it("returns nothing for a result with no mailboxes", () => {
		assert.deepEqual(resolveResultFolder(index, []), {});
	});

	it("still names a mailbox before the index has loaded", () => {
		assert.deepEqual(resolveResultFolder(undefined, ["mb-inbox"]), {
			mailboxId: "mb-inbox",
		});
	});
});

describe("buildResultFolderIndex before the mailbox list arrives", () => {
	it("still knows the appointed role, so spam is never let through", () => {
		const index = buildResultFolderIndex([
			account([{ role: "Junk", mailboxId: "mb-junk" }], []),
		]);

		assert.deepEqual(index.get("mb-junk"), { role: "junk" });
	});
});
