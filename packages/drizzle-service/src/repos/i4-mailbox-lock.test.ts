import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { MailboxLockRepo } from "./i4-mailbox-lock.js";

describe("MailboxLockRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: MailboxLockRepo;

	async function seedExpiredLock(input: {
		mailboxId: string;
		eventName: string;
		accountId: string;
		lockId: string;
	}): Promise<void> {
		await db.insert(mailboxLockTable).values({
			...input,
			lockedBy: input.eventName,
			acquiredAt: Date.now() - 3_600_000,
			ttl: Math.floor(Date.now() / 1000) - 60,
		});
	}

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new MailboxLockRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("tryAcquireLock acquires lock when none exists", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const lockId = randomId();
		const eventName = "SYNC_MESSAGES";

		const acquired = await repo.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			lockId,
		);
		assert.equal(acquired, true, "should acquire lock");

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.ok(lock, "lock should exist");
		assert.equal(lock.mailboxId, mailboxId);
		assert.equal(lock.eventName, eventName);
		assert.equal(lock.accountId, accountId);
		assert.equal(lock.lockId, lockId);
		assert.ok(lock.acquiredAt > 0);
		assert.ok(lock.ttl > 0);

		// cleanup
		await repo.releaseLock(accountId, mailboxId, eventName, lockId);
	});

	test("tryAcquireLock fails (returns false) when lock already held", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const lockId1 = randomId();
		const lockId2 = randomId();
		const eventName = "SYNC_MESSAGES";

		const first = await repo.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			lockId1,
		);
		assert.equal(first, true, "first acquire should succeed");

		const second = await repo.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			lockId2,
		);
		assert.equal(second, false, "second acquire should fail");

		await repo.releaseLock(accountId, mailboxId, eventName, lockId1);
	});

	test("tryAcquireLock steals an expired lock", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const staleLockId = randomId();
		const freshLockId = randomId();
		const eventName = "SYNC_MESSAGES";

		await seedExpiredLock({
			mailboxId,
			eventName,
			accountId,
			lockId: staleLockId,
		});

		const acquired = await repo.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			freshLockId,
		);
		assert.equal(acquired, true, "should steal the expired lock");

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.ok(lock, "lock should exist");
		assert.equal(
			lock.lockId,
			freshLockId,
			"lock should be owned by new holder",
		);
		assert.ok(
			lock.ttl > Math.floor(Date.now() / 1000),
			"ttl should be renewed",
		);

		await repo.releaseLock(accountId, mailboxId, eventName, freshLockId);
	});

	test("tryAcquireLock refuses to steal a live lock", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const liveLockId = randomId();
		const contenderLockId = randomId();
		const eventName = "SYNC_MESSAGES";

		await repo.tryAcquireLock(mailboxId, eventName, accountId, liveLockId);

		const acquired = await repo.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			contenderLockId,
		);
		assert.equal(acquired, false, "should not steal a live lock");

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.ok(lock, "lock should still exist");
		assert.equal(
			lock.lockId,
			liveLockId,
			"live lock owner should be unchanged",
		);

		await repo.releaseLock(accountId, mailboxId, eventName, liveLockId);
	});

	test("only one contender wins when stealing the same expired lock", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const staleLockId = randomId();
		const contenderA = randomId();
		const contenderB = randomId();
		const eventName = "SYNC_MESSAGES";

		await seedExpiredLock({
			mailboxId,
			eventName,
			accountId,
			lockId: staleLockId,
		});

		const results = await Promise.all([
			repo.tryAcquireLock(mailboxId, eventName, accountId, contenderA),
			repo.tryAcquireLock(mailboxId, eventName, accountId, contenderB),
		]);

		assert.equal(
			results.filter(Boolean).length,
			1,
			"exactly one contender should win",
		);

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.ok(lock);
		await repo.releaseLock(accountId, mailboxId, eventName, lock.lockId);
	});

	test("releaseLock removes the lock when lockId matches", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const lockId = randomId();
		const eventName = "SYNC_MESSAGES";

		await repo.tryAcquireLock(mailboxId, eventName, accountId, lockId);
		await repo.releaseLock(accountId, mailboxId, eventName, lockId);

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.equal(lock, null, "lock should be released");
	});

	test("releaseLock is a no-op when lockId does not match", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const lockId1 = randomId();
		const lockId2 = randomId();
		const eventName = "SYNC_MESSAGES";

		await repo.tryAcquireLock(mailboxId, eventName, accountId, lockId1);
		await repo.releaseLock(accountId, mailboxId, eventName, lockId2); // wrong lockId

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.ok(lock, "lock should still exist");
		assert.equal(lock.lockId, lockId1);

		await repo.releaseLock(accountId, mailboxId, eventName, lockId1);
	});

	test("withMailboxLock executes and releases", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const eventName = "SYNC_MESSAGES";

		let ran = false;
		const result = await repo.withMailboxLock(
			mailboxId,
			eventName,
			accountId,
			async () => {
				ran = true;
				return "done";
			},
		);

		assert.equal(result.executed, true);
		assert.equal(result.result, "done");
		assert.equal(ran, true);

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.equal(lock, null, "lock released after operation");
	});

	test("withMailboxLock skips when lock already held", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const lockId = randomId();
		const eventName = "SYNC_MESSAGES";

		await repo.tryAcquireLock(mailboxId, eventName, accountId, lockId);

		const result = await repo.withMailboxLock(
			mailboxId,
			eventName,
			accountId,
			async () => "should not run",
		);

		assert.equal(result.executed, false);

		await repo.releaseLock(accountId, mailboxId, eventName, lockId);
	});

	test("withMailboxLock releases even if operation throws", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const eventName = "SYNC_MESSAGES";

		await assert.rejects(
			repo.withMailboxLock(mailboxId, eventName, accountId, async () => {
				throw new Error("boom");
			}),
			/boom/,
		);

		const lock = await repo.get(accountId, mailboxId, eventName);
		assert.equal(lock, null, "lock released after throw");
	});

	test("get returns null when no lock exists", async () => {
		const lock = await repo.get(randomId(), randomId(), "SYNC_MESSAGES");
		assert.equal(lock, null);
	});

	test("different eventNames create separate locks", async () => {
		const mailboxId = randomId();
		const accountId = randomId();
		const lockId1 = randomId();
		const lockId2 = randomId();

		const a1 = await repo.tryAcquireLock(
			mailboxId,
			"SYNC_MESSAGES",
			accountId,
			lockId1,
		);
		const a2 = await repo.tryAcquireLock(
			mailboxId,
			"SYNC_FLAGS",
			accountId,
			lockId2,
		);

		assert.equal(a1, true);
		assert.equal(a2, true);

		await repo.releaseLock(accountId, mailboxId, "SYNC_MESSAGES", lockId1);
		await repo.releaseLock(accountId, mailboxId, "SYNC_FLAGS", lockId2);
	});

	test("listByAccount returns locks for that account only", async () => {
		const mailboxId1 = randomId();
		const mailboxId2 = randomId();
		const accountId1 = randomId();
		const accountId2 = randomId();
		const lockId1 = randomId();
		const lockId2 = randomId();
		const eventName = "SYNC_MESSAGES";

		await repo.tryAcquireLock(mailboxId1, eventName, accountId1, lockId1);
		await repo.tryAcquireLock(mailboxId2, eventName, accountId2, lockId2);

		const locks = await repo.listByAccount(accountId1);
		assert.equal(locks.filter((l) => l.lockId === lockId1).length, 1);
		assert.equal(locks.filter((l) => l.lockId === lockId2).length, 0);

		await repo.releaseLock(accountId1, mailboxId1, eventName, lockId1);
		await repo.releaseLock(accountId2, mailboxId2, eventName, lockId2);
	});

	test("deleteByAccount removes all locks for that account", async () => {
		const accountId = randomId();
		const lockId1 = randomId();
		const lockId2 = randomId();
		const mb1 = randomId();
		const mb2 = randomId();

		await repo.tryAcquireLock(mb1, "SYNC_MESSAGES", accountId, lockId1);
		await repo.tryAcquireLock(mb2, "SYNC_FLAGS", accountId, lockId2);

		await repo.deleteByAccount(accountId);

		const locks = await repo.listByAccount(accountId);
		assert.equal(locks.length, 0);
	});

	test("get is scoped to accountId (foreign account sees nothing)", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailboxId = randomId();
		const lockId = randomId();
		await repo.tryAcquireLock(mailboxId, "SYNC_MESSAGES", accountId, lockId);

		assert.ok(await repo.get(accountId, mailboxId, "SYNC_MESSAGES"));
		assert.equal(await repo.get(other, mailboxId, "SYNC_MESSAGES"), null);

		await repo.releaseLock(accountId, mailboxId, "SYNC_MESSAGES", lockId);
	});

	test("releaseLock does not release another account's lock", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailboxId = randomId();
		const lockId = randomId();
		await repo.tryAcquireLock(mailboxId, "SYNC_MESSAGES", accountId, lockId);

		// Foreign account with the (leaked) lockId still cannot release it.
		await repo.releaseLock(other, mailboxId, "SYNC_MESSAGES", lockId);
		assert.ok(await repo.get(accountId, mailboxId, "SYNC_MESSAGES"));

		await repo.releaseLock(accountId, mailboxId, "SYNC_MESSAGES", lockId);
		assert.equal(await repo.get(accountId, mailboxId, "SYNC_MESSAGES"), null);
	});
});
