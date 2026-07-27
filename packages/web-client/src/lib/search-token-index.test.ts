import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	buildAccountNameIndex,
	buildAccountSuggestionValues,
	buildMailboxNameIndex,
	buildMailboxSuggestionValues,
} from "./search-token-index.js";

const account = (
	overrides: Partial<RemitImapAccountResponse> &
		Pick<RemitImapAccountResponse, "accountId" | "email">,
): RemitImapAccountResponse =>
	({
		accountConfigId: "cfg-1",
		username: "user",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		smtpHost: "smtp.example.com",
		smtpPort: 587,
		smtpTls: false,
		smtpStartTls: true,
		smtpUsername: "user",
		isActive: true,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	}) as RemitImapAccountResponse;

const mailbox = (
	overrides: Partial<RemitImapMailboxResponse> &
		Pick<RemitImapMailboxResponse, "mailboxId" | "fullPath">,
): RemitImapMailboxResponse =>
	({
		accountId: "account-1",
		namespaceType: "personal",
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	}) as RemitImapMailboxResponse;

describe("buildAccountNameIndex", () => {
	it("indexes by local-part and full email, lower-cased", () => {
		const index = buildAccountNameIndex([
			account({ accountId: "acct-1", email: "Work@Company.com" }),
		]);
		assert.equal(index.get("work"), "acct-1");
		assert.equal(index.get("work@company.com"), "acct-1");
	});

	it("first account wins a local-part collision", () => {
		const index = buildAccountNameIndex([
			account({ accountId: "acct-1", email: "work@company.com" }),
			account({ accountId: "acct-2", email: "work@other.com" }),
		]);
		assert.equal(index.get("work"), "acct-1");
	});

	it("empty accounts yields an empty index", () => {
		assert.deepEqual(buildAccountNameIndex([]), new Map());
	});
});

describe("buildMailboxNameIndex", () => {
	it("indexes by full path and last segment, lower-cased", () => {
		const index = buildMailboxNameIndex([
			[mailbox({ mailboxId: "mb-1", fullPath: "INBOX/Archive" })],
		]);
		assert.equal(index.get("inbox/archive"), "mb-1");
		assert.equal(index.get("archive"), "mb-1");
	});

	it("merges mailbox lists across multiple accounts", () => {
		const index = buildMailboxNameIndex([
			[mailbox({ mailboxId: "mb-1", fullPath: "Archive" })],
			[mailbox({ mailboxId: "mb-2", fullPath: "Sent" })],
		]);
		assert.equal(index.get("archive"), "mb-1");
		assert.equal(index.get("sent"), "mb-2");
	});

	it("first mailbox wins a name collision across accounts", () => {
		const index = buildMailboxNameIndex([
			[mailbox({ mailboxId: "mb-1", fullPath: "Archive" })],
			[mailbox({ mailboxId: "mb-2", fullPath: "Archive" })],
		]);
		assert.equal(index.get("archive"), "mb-1");
	});

	it("skips mailboxes with no fullPath", () => {
		const index = buildMailboxNameIndex([
			[mailbox({ mailboxId: "mb-1", fullPath: "" })],
		]);
		assert.equal(index.size, 0);
	});

	it("empty input yields an empty index", () => {
		assert.deepEqual(buildMailboxNameIndex([]), new Map());
	});
});

describe("buildMailboxSuggestionValues", () => {
	it("offers the leaf when no other folder shares it", () => {
		const [offer] = buildMailboxSuggestionValues([
			[mailbox({ mailboxId: "mb-1", fullPath: "INBOX/Archive" })],
		]);
		assert.equal(offer?.value, "Archive");
		assert.equal(offer?.label, "Archive");
	});

	it("offers the full path where the leaf would be ambiguous", () => {
		const offers = buildMailboxSuggestionValues([
			[mailbox({ mailboxId: "mb-1", fullPath: "INBOX/Archive" })],
			[mailbox({ mailboxId: "mb-2", fullPath: "Work/archive" })],
		]);
		assert.deepEqual(
			offers.map((offer) => offer.value),
			["INBOX/Archive", "Work/archive"],
		);
	});

	it("every offer resolves back through the index it was built beside", () => {
		const lists = [
			[
				mailbox({ mailboxId: "mb-1", fullPath: "INBOX" }),
				mailbox({ mailboxId: "mb-2", fullPath: "INBOX/Archive" }),
			],
			[mailbox({ mailboxId: "mb-3", fullPath: "Team/Archive" })],
		];
		const index = buildMailboxNameIndex(lists);
		for (const offer of buildMailboxSuggestionValues(lists)) {
			assert.ok(index.has(offer.value.toLowerCase()), offer.value);
		}
	});

	it("reads the folder's own name, a rename winning over the path", () => {
		const [offer] = buildMailboxSuggestionValues([
			[
				mailbox({
					mailboxId: "mb-1",
					fullPath: "INBOX/Archief",
					displayNameOverride: " Archive ",
				}),
			],
		]);
		assert.equal(offer?.value, "Archief");
		assert.equal(offer?.label, "Archive");
	});

	it("names the account only where more than one is loaded", () => {
		const lists = [[mailbox({ mailboxId: "mb-1", fullPath: "Archive" })]];
		const accounts = [
			account({ accountId: "account-1", email: "me@example.com" }),
		];
		assert.equal(
			buildMailboxSuggestionValues(lists, accounts)[0]?.hint,
			undefined,
		);
		assert.equal(
			buildMailboxSuggestionValues(lists, [
				...accounts,
				account({ accountId: "account-2", email: "work@example.com" }),
			])[0]?.hint,
			"me@example.com",
		);
	});
});

describe("buildAccountSuggestionValues", () => {
	it("offers the local part, read as the account's own name", () => {
		const [offer] = buildAccountSuggestionValues([
			account({
				accountId: "acct-1",
				email: "work@company.com",
				displayName: "Work",
			}),
		]);
		assert.equal(offer?.value, "work");
		assert.equal(offer?.label, "Work");
		assert.equal(offer?.hint, "work@company.com");
	});

	it("offers the whole address where the local part is ambiguous", () => {
		const offers = buildAccountSuggestionValues([
			account({ accountId: "acct-1", email: "work@company.com" }),
			account({ accountId: "acct-2", email: "work@other.com" }),
		]);
		assert.deepEqual(
			offers.map((offer) => offer.value),
			["work@company.com", "work@other.com"],
		);
		assert.deepEqual(
			offers.map((offer) => offer.label),
			["work@company.com", "work@other.com"],
		);
	});
});
