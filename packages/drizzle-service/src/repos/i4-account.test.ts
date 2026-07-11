import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { AccountRepo } from "./i4-account.js";
import { MailboxRepo } from "./i4-mailbox.js";

function makeAccountInput(accountConfigId: string) {
	return {
		accountConfigId,
		username: "testuser",
		email: "test@example.com",
		isActive: true,
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		connectionState: "not_authenticated" as const,
	};
}

describe("AccountRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: AccountRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new AccountRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create and get", async () => {
		const accountConfigId = randomId();
		const account = await repo.create(makeAccountInput(accountConfigId));

		assert.ok(account.accountId, "accountId generated");
		assert.equal(account.accountConfigId, accountConfigId);
		assert.equal(account.authType, "password");

		const fetched = await repo.get(account.accountId);
		assert.equal(fetched.accountId, account.accountId);

		await repo.delete(account.accountId);
	});

	test("batchGet: WHERE id = ANY($1)", async () => {
		const accountConfigId = randomId();
		const a1 = await repo.create(makeAccountInput(accountConfigId));
		const a2 = await repo.create(makeAccountInput(accountConfigId));

		const results = await repo.get([a1.accountId, a2.accountId]);
		assert.equal(results.length, 2);

		await repo.deleteMany([a1.accountId, a2.accountId]);
	});

	test("batchGet with empty array returns []", async () => {
		const results = await repo.get([]);
		assert.deepEqual(results, []);
	});

	test("get throws NotFoundError for missing account", async () => {
		await assert.rejects(repo.get(randomId()), /not found/i);
	});

	test("markAuthenticated clears lastError and sets connectionState", async () => {
		const created = await repo.create({
			...makeAccountInput(randomId()),
			lastError: "previous failure",
		});

		const updated = await repo.markAuthenticated(created.accountId);

		assert.equal(updated.connectionState, "authenticated");
		assert.equal(updated.lastError, undefined);
		assert.ok((updated.lastConnectedAt ?? 0) > 0);

		await repo.delete(created.accountId);
	});

	test("incrementMailboxSynced atomically increments counter", async () => {
		const account = await repo.create({
			...makeAccountInput(randomId()),
			syncPhase: "syncing_others",
			mailboxCountTotal: 3,
			mailboxCountSynced: 0,
		});

		const updated = await repo.incrementMailboxSynced(account.accountId);
		assert.equal(updated.mailboxCountSynced, 1);
		assert.equal(updated.syncPhase, "syncing_others");

		await repo.delete(account.accountId);
	});

	test("incrementMailboxSynced transitions to complete when all done", async () => {
		const account = await repo.create({
			...makeAccountInput(randomId()),
			syncPhase: "syncing_others",
			mailboxCountTotal: 2,
			mailboxCountSynced: 1,
		});

		const updated = await repo.incrementMailboxSynced(account.accountId);
		assert.equal(updated.mailboxCountSynced, 2);
		assert.equal(updated.syncPhase, "complete");

		await repo.delete(account.accountId);
	});

	test("incrementMailboxSynced clamps to total on duplicate completions", async () => {
		const account = await repo.create({
			...makeAccountInput(randomId()),
			syncPhase: "syncing_others",
			mailboxCountTotal: 2,
			mailboxCountSynced: 2,
		});

		const updated = await repo.incrementMailboxSynced(account.accountId);
		assert.equal(updated.mailboxCountSynced, 2, "should clamp to total");
		assert.equal(updated.syncPhase, "complete");

		await repo.delete(account.accountId);
	});

	test("list paginates without dupes, gaps, or non-termination", async () => {
		const accountConfigId = randomId();
		const created: string[] = [];
		for (let i = 0; i < 5; i++) {
			const account = await repo.create(makeAccountInput(accountConfigId));
			created.push(account.accountId);
		}

		const seen: string[] = [];
		let continuationToken: string | undefined;
		let pages = 0;
		do {
			const page = await repo.list(accountConfigId, {
				limit: 2,
				continuationToken,
			});
			seen.push(...page.items.map((a) => a.accountId));
			continuationToken = page.continuationToken;
			pages++;
			assert.ok(pages < 10, "pagination must terminate");
		} while (continuationToken);

		assert.equal(seen.length, 5, "every row returned exactly once");
		assert.equal(new Set(seen).size, 5, "no duplicates across pages");
		assert.deepEqual([...seen].sort(), [...created].sort(), "no gaps");

		await repo.deleteMany(created);
	});

	test("describe assembles account + mailbox collection", async () => {
		const accountConfigId = randomId();
		const account = await repo.create(makeAccountInput(accountConfigId));

		const mailboxRepo = new MailboxRepo(db as never);
		await mailboxRepo.create({
			accountId: account.accountId,
			namespaceType: "personal",
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: "INBOX",
			uidValidity: 1,
			uidNext: 1,
			highestModseq: 0,
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: Date.now(),
		});

		const desc = await repo.describe(account.accountId);
		assert.equal(desc.account.length, 1);
		assert.equal(desc.mailbox.length, 1);
		assert.equal(desc.mailbox[0].fullPath, "INBOX");

		await repo.delete(account.accountId);
	});

	test("listAllAccountsPage paginates without dupes, gaps, or non-termination", async () => {
		const accountConfigId = randomId();
		const created: string[] = [];
		for (let i = 0; i < 5; i++) {
			const account = await repo.create(makeAccountInput(accountConfigId));
			created.push(account.accountId);
		}

		const seen: string[] = [];
		let cursor: string | undefined;
		let pages = 0;
		do {
			const page = await repo.listAllAccountsPage({ limit: 2, cursor });
			seen.push(...page.items.map((a) => a.accountId));
			cursor = page.cursor ?? undefined;
			pages++;
			assert.ok(pages < 50, "pagination must terminate");
		} while (cursor);

		for (const accountId of created) {
			assert.ok(
				seen.includes(accountId),
				`created account ${accountId} must appear in a page`,
			);
		}
		const seenCreated = seen.filter((id) => created.includes(id));
		assert.equal(
			new Set(seenCreated).size,
			seenCreated.length,
			"no duplicates across pages",
		);

		await repo.deleteMany(created);
	});
});
