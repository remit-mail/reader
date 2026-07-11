import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	buildAccountNameIndex,
	buildMailboxNameIndex,
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
