import assert from "node:assert";
import { describe, test } from "node:test";
import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { buildMoveTargets } from "./move-targets.js";

const make = (
	overrides: Partial<RemitImapMailboxResponse> & {
		mailboxId: string;
		fullPath: string;
	},
): RemitImapMailboxResponse =>
	({
		accountId: "acct-1",
		namespaceType: "personal",
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as RemitImapMailboxResponse;

const appoint = (
	role: RemitImapFolderAppointment["role"],
	mailboxId: string,
): RemitImapFolderAppointment => ({ role, mailboxId });

describe("buildMoveTargets — excluded destinations (#236, #976)", () => {
	test("drops the account's appointed Drafts and Sent mailboxes", () => {
		const result = buildMoveTargets(
			[
				make({ mailboxId: "m1", fullPath: "INBOX" }),
				make({ mailboxId: "m2", fullPath: "Drafts" }),
				make({ mailboxId: "m3", fullPath: "Sent" }),
			],
			[appoint("Drafts", "m2"), appoint("Sent", "m3")],
		);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["m1"]);
	});

	test("keeps an UNappointed Drafts/Sent look-alike — exclusion follows the appointment, not the name", () => {
		// Hostnet-style: INBOX/Drafts carries the flag but is empty; the user
		// appointed INBOX/Concepten instead. INBOX/Drafts is now just a plain
		// folder and a valid move destination.
		const result = buildMoveTargets(
			[
				make({ mailboxId: "inbox", fullPath: "INBOX" }),
				make({ mailboxId: "empty-drafts", fullPath: "INBOX/Drafts" }),
				make({ mailboxId: "concepten", fullPath: "INBOX/Concepten" }),
			],
			[appoint("Drafts", "concepten")],
		);
		const ids = result.map((mailbox) => mailbox.mailboxId).sort();
		assert.deepStrictEqual(ids, ["empty-drafts", "inbox"]);
	});

	test("with no appointments at all, nothing is excluded by role (only Outbox by name)", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Drafts" }),
			make({ mailboxId: "m3", fullPath: "Outbox" }),
			make({ mailboxId: "m4", fullPath: "Sent Mail" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId).sort();
		assert.deepStrictEqual(ids, ["m1", "m2", "m4"]);
	});

	test("keeps Trash and Spam — both are valid manual destinations", () => {
		const result = buildMoveTargets(
			[
				make({ mailboxId: "trash", fullPath: "Trash" }),
				make({ mailboxId: "spam", fullPath: "Spam" }),
				make({ mailboxId: "inbox", fullPath: "INBOX" }),
			],
			[
				appoint("Trash", "trash"),
				appoint("Junk", "spam"),
				appoint("Inbox", "inbox"),
			],
		);
		const ids = result.map((mailbox) => mailbox.mailboxId).sort();
		assert.deepStrictEqual(ids, ["inbox", "spam", "trash"]);
	});

	test("keeps user-defined folders", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "m1", fullPath: "INBOX" }),
			make({ mailboxId: "m2", fullPath: "Project Alpha" }),
			make({ mailboxId: "m3", fullPath: "Receipts/2025" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids.sort(), ["m1", "m2", "m3"]);
	});
});

describe("buildMoveTargets — sort order", () => {
	test("orders appointed system folders by role priority, ahead of plain folders", () => {
		const result = buildMoveTargets(
			[
				make({ mailboxId: "custom", fullPath: "Project Alpha" }),
				make({ mailboxId: "trash", fullPath: "Trash" }),
				make({ mailboxId: "archive", fullPath: "Archive" }),
				make({ mailboxId: "inbox", fullPath: "INBOX" }),
			],
			[
				appoint("Trash", "trash"),
				appoint("Archive", "archive"),
				appoint("Inbox", "inbox"),
			],
		);
		assert.deepStrictEqual(
			result.map((m) => m.mailboxId),
			["inbox", "archive", "trash", "custom"],
		);
	});

	test("plain folders sort alphabetically, case-insensitively", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "b", fullPath: "banana" }),
			make({ mailboxId: "a", fullPath: "Apple" }),
		]);
		assert.deepStrictEqual(
			result.map((m) => m.mailboxId),
			["a", "b"],
		);
	});
});

describe("buildMoveTargets — Outbox locale exclusion (#290)", () => {
	// Outbox has no IMAP special-use flag and isn't a canonical role, so we
	// recognize it by name across the locales the curated list covers.
	const localizedOutboxNames: readonly string[] = [
		"Outbox",
		"Postvak UIT",
		"Boîte d'envoi",
		"Postausgang",
		"Buzón de salida",
		"Posta in uscita",
		"送信トレイ",
		"送件匣",
		"发件箱",
		"Skrzynka nadawcza",
	];

	for (const name of localizedOutboxNames) {
		test(`drops localized Outbox "${name}"`, () => {
			const result = buildMoveTargets([
				make({ mailboxId: "inbox", fullPath: "INBOX" }),
				make({ mailboxId: "outbox", fullPath: name }),
			]);
			const ids = result.map((mailbox) => mailbox.mailboxId);
			assert.deepStrictEqual(ids, ["inbox"]);
		});
	}

	test("matches Outbox locale names case-insensitively", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
			make({ mailboxId: "m1", fullPath: "POSTVAK UIT" }),
			make({ mailboxId: "m2", fullPath: "postausgang" }),
			make({ mailboxId: "m3", fullPath: "BOÎTE D'ENVOI" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["inbox"]);
	});

	test("matches Outbox locale names with surrounding whitespace", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
			make({ mailboxId: "m1", fullPath: "  Outbox  " }),
			make({ mailboxId: "m2", fullPath: " Postvak UIT " }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId);
		assert.deepStrictEqual(ids, ["inbox"]);
	});

	test("does not over-match unrelated mailbox names", () => {
		const result = buildMoveTargets([
			make({ mailboxId: "inbox", fullPath: "INBOX" }),
			make({ mailboxId: "trash", fullPath: "Trash" }),
			make({ mailboxId: "custom", fullPath: "Custom Folder" }),
			// Substring of a locale name must not trigger the filter — only
			// the exact normalized leaf matches.
			make({ mailboxId: "outboxy", fullPath: "Outbox Archive" }),
		]);
		const ids = result.map((mailbox) => mailbox.mailboxId).sort();
		assert.deepStrictEqual(ids, ["custom", "inbox", "outboxy", "trash"]);
	});
});
