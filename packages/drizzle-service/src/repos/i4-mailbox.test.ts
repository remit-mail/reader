import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
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
		highestModseq: 0,
		messageCount: 0,
		unseenCount: 5,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: Date.now(),
	};
}

describe("MailboxRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new MailboxRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create and get", async () => {
		const accountId = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));
		assert.ok(mailbox.mailboxId);
		assert.equal(mailbox.fullPath, "INBOX");

		const fetched = await repo.get(accountId, mailbox.mailboxId);
		assert.equal(fetched.mailboxId, mailbox.mailboxId);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("batchGet: WHERE id = ANY($1)", async () => {
		const accountId = randomId();
		const m1 = await repo.create(makeMailboxInput(accountId, "INBOX"));
		const m2 = await repo.create(makeMailboxInput(accountId, "Sent"));

		const results = await repo.get(accountId, [m1.mailboxId, m2.mailboxId]);
		assert.equal(results.length, 2);

		await repo.deleteMany(accountId, [m1.mailboxId, m2.mailboxId]);
	});

	test("batchGet empty array returns []", async () => {
		const results = await repo.get(randomId(), []);
		assert.deepEqual(results, []);
	});

	test("findByPath finds existing mailbox", async () => {
		const accountId = randomId();
		await repo.create(makeMailboxInput(accountId, "Work/Projects"));

		const found = await repo.findByPath(accountId, "Work/Projects");
		assert.ok(found);
		assert.equal(found.fullPath, "Work/Projects");
	});

	test("findByPath returns null when not found", async () => {
		const result = await repo.findByPath(randomId(), "INBOX");
		assert.equal(result, null);
	});

	test("getOrCreateByPath creates when missing", async () => {
		const accountId = randomId();
		const mailbox = await repo.getOrCreateByPath(
			accountId,
			"Drafts",
			makeMailboxInput(accountId, "Drafts"),
		);
		assert.equal(mailbox.fullPath, "Drafts");

		const again = await repo.getOrCreateByPath(
			accountId,
			"Drafts",
			makeMailboxInput(accountId, "Drafts"),
		);
		assert.equal(again.mailboxId, mailbox.mailboxId, "idempotent");
	});

	test("findByPathPrefix finds children", async () => {
		const accountId = randomId();
		await repo.create(makeMailboxInput(accountId, "Work"));
		await repo.create(makeMailboxInput(accountId, "Work/Projects"));
		await repo.create(makeMailboxInput(accountId, "Work/Projects/Alpha"));

		const children = await repo.findByPathPrefix(accountId, "Work");
		assert.ok(children.some((m) => m.fullPath === "Work/Projects"));
		assert.ok(children.some((m) => m.fullPath === "Work/Projects/Alpha"));
		assert.equal(
			children.find((m) => m.fullPath === "Work"),
			undefined,
			"prefix itself not included",
		);
	});

	test("renameChildPaths updates all children", async () => {
		const accountId = randomId();
		await repo.create(makeMailboxInput(accountId, "OldName/Sub1"));
		await repo.create(makeMailboxInput(accountId, "OldName/Sub2"));

		await repo.renameChildPaths(accountId, "OldName", "NewName");

		const sub1 = await repo.findByPath(accountId, "NewName/Sub1");
		const sub2 = await repo.findByPath(accountId, "NewName/Sub2");
		assert.ok(sub1, "Sub1 renamed");
		assert.ok(sub2, "Sub2 renamed");
	});

	test("cross-tenant: get refuses a foreign account", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));

		await assert.rejects(
			() => repo.get(other, mailbox.mailboxId),
			/Mailbox not found/,
		);
		assert.deepEqual(await repo.get(other, [mailbox.mailboxId]), []);
		const owned = await repo.get(accountId, [mailbox.mailboxId]);
		assert.equal(owned.length, 1);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("cross-tenant: update refuses a foreign account and leaves the row unchanged", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));

		await assert.rejects(
			() => repo.update(other, mailbox.mailboxId, { messageCount: 99 }),
			/Mailbox not found/,
		);
		const still = await repo.get(accountId, mailbox.mailboxId);
		assert.equal(still.messageCount, 0);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("cross-tenant: delete is a no-op for a foreign account", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));

		await repo.delete(other, mailbox.mailboxId);
		const still = await repo.get(accountId, mailbox.mailboxId);
		assert.equal(still.mailboxId, mailbox.mailboxId);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("cross-tenant: deleteMany only removes ids owned by the tenant", async () => {
		const accountA = randomId();
		const accountB = randomId();
		const a = await repo.create(makeMailboxInput(accountA));
		const b = await repo.create(makeMailboxInput(accountB));

		await repo.deleteMany(accountA, [a.mailboxId, b.mailboxId]);

		await assert.rejects(
			() => repo.get(accountA, a.mailboxId),
			/Mailbox not found/,
		);
		const survived = await repo.get(accountB, b.mailboxId);
		assert.equal(survived.mailboxId, b.mailboxId);

		await repo.delete(accountB, b.mailboxId);
	});
});
