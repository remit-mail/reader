import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { mailboxSpecialUseTable, mailboxTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { MailboxRepo } from "./i4-mailbox.js";
import { MailboxSpecialUseRepo } from "./i4-mailbox-special-use.js";

const makeMailboxInput = (accountId: string, fullPath: string) => ({
	accountId,
	namespaceType: "personal" as const,
	namespacePrefix: "",
	hierarchyDelimiter: "/",
	fullPath,
	uidValidity: 1,
	uidNext: 1,
	highestModseq: "0",
	messageCount: 0,
	unseenCount: 0,
	deletedCount: 0,
	totalSize: 0,
	lastSyncUid: 0,
	highWaterMarkUid: 0,
	lastMessageSyncAt: Date.now(),
});

describe("MailboxSpecialUseRepo.findJunkMailbox (sqlite)", () => {
	let close: () => Promise<void>;
	let repo: MailboxSpecialUseRepo;
	let mailboxes: MailboxRepo;

	before(async () => {
		const testDb = await createSqliteTestDb({
			mailbox: mailboxTable,
			mailboxSpecialUse: mailboxSpecialUseTable,
		});
		close = testDb.close;
		repo = new MailboxSpecialUseRepo(testDb.db as never);
		mailboxes = new MailboxRepo(testDb.db as never);
	});

	after(async () => {
		await close();
	});

	test("resolves an INBOX-nested Junk folder that advertises \\Junk", async () => {
		const accountId = randomUUID();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const spam = await mailboxes.create(
			makeMailboxInput(accountId, "INBOX/Spam"),
		);
		await repo.create(spam.mailboxId, "Junk");

		const found = await repo.findJunkMailbox(accountId);
		assert.equal(found?.mailboxId, spam.mailboxId);
	});

	test("resolves an INBOX-nested Junk folder that advertises no special use", async () => {
		// The name fallback used to compare the whole path against a list of
		// bare names, so `INBOX/Spam` resolved to nothing on a server that
		// advertises no \Junk.
		const accountId = randomUUID();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		const spam = await mailboxes.create(
			makeMailboxInput(accountId, "INBOX/Spam"),
		);

		const found = await repo.findJunkMailbox(accountId);
		assert.equal(found?.mailboxId, spam.mailboxId);
	});

	test("answers null when the account has no Junk folder at all", async () => {
		const accountId = randomUUID();
		await mailboxes.create(makeMailboxInput(accountId, "INBOX"));
		await mailboxes.create(makeMailboxInput(accountId, "INBOX/Work"));

		assert.equal(await repo.findJunkMailbox(accountId), null);
	});
});
