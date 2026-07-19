import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { mailboxTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { MailboxRepo } from "./i4-mailbox.js";

function makeMailboxInput(accountId: string, fullPath = "INBOX") {
	return {
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
	};
}

describe("MailboxRepo (sqlite)", () => {
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(async () => {
		const testDb = await createSqliteTestDb({ mailbox: mailboxTable });
		close = testDb.close;
		repo = new MailboxRepo(testDb.db as never);
	});

	after(async () => {
		await close();
	});

	test("highestModseq round-trips a value above 2^53 without loss (reader#9)", async () => {
		const accountId = randomUUID();
		const modseq = "18446744073709551615";

		const created = await repo.create({
			...makeMailboxInput(accountId),
			highestModseq: modseq,
		});
		assert.equal(created.highestModseq, modseq);

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.equal(fetched.highestModseq, modseq);
		assert.equal(BigInt(fetched.highestModseq) > 2n ** 53n, true);

		const updated = await repo.update(accountId, created.mailboxId, {
			highestModseq: "9007199254740993",
		});
		assert.equal(updated.highestModseq, "9007199254740993");
		const reread = await repo.get(accountId, created.mailboxId);
		assert.equal(reread.highestModseq, "9007199254740993");
	});
});
