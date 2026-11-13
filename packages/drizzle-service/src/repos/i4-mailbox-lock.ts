import type {
	IMailboxLockRepository,
	MailboxLease,
	MailboxLockItem,
	WithMailboxLockResult,
} from "@remit/data-ports";
import { LostLeaseError } from "@remit/data-ports/errors";
import { and, eq, lt } from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { randomId } from "../id.js";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";

type DB = RepositoryDb;

const LEASE_SECONDS = 60;

function rowToItem(row: typeof mailboxLockTable.$inferSelect): MailboxLockItem {
	return {
		mailboxId: row.mailboxId,
		eventName: row.eventName,
		accountId: row.accountId,
		lockId: row.lockId,
		acquiredAt: row.acquiredAt,
		lockedBy: row.lockedBy,
		ttl: row.ttl,
	};
}

export class MailboxLockRepo implements IMailboxLockRepository {
	constructor(
		private db: DB,
		private leaseSeconds = LEASE_SECONDS,
	) {}

	async tryAcquireLock(
		mailboxId: string,
		eventName: string,
		accountId: string,
		lockId: string,
		ttlSeconds: number,
	): Promise<boolean> {
		const now = Date.now();
		const nowSeconds = Math.floor(now / 1000);
		const ttl = nowSeconds + ttlSeconds;

		const rows = await this.db
			.insert(mailboxLockTable)
			.values({
				mailboxId,
				eventName,
				accountId,
				lockId,
				acquiredAt: now,
				lockedBy: eventName,
				ttl,
			})
			.onConflictDoUpdate({
				target: [mailboxLockTable.mailboxId, mailboxLockTable.eventName],
				set: { accountId, lockId, acquiredAt: now, lockedBy: eventName, ttl },
				setWhere: lt(mailboxLockTable.ttl, nowSeconds),
			})
			.returning();

		return rows.length > 0;
	}

	async releaseLock(
		accountId: string,
		mailboxId: string,
		eventName: string,
		lockId: string,
	): Promise<void> {
		await this.db
			.delete(mailboxLockTable)
			.where(
				and(
					eq(mailboxLockTable.accountId, accountId),
					eq(mailboxLockTable.mailboxId, mailboxId),
					eq(mailboxLockTable.eventName, eventName),
					eq(mailboxLockTable.lockId, lockId),
				),
			);
	}

	async withMailboxLock<T>(
		mailboxId: string,
		eventName: string,
		accountId: string,
		operation: (lease: MailboxLease) => Promise<T>,
		options?: { lockId?: string },
	): Promise<WithMailboxLockResult<T>> {
		const lockId = options?.lockId ?? randomId();

		const acquired = await this.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			lockId,
			this.leaseSeconds,
		);
		if (!acquired) return { executed: false };

		const lease: MailboxLease = {
			renew: () => this.renewLock(accountId, mailboxId, eventName, lockId),
		};
		return operation(lease)
			.then((result) => ({ executed: true as const, result }))
			.finally(() => this.releaseLock(accountId, mailboxId, eventName, lockId));
	}

	private async renewLock(
		accountId: string,
		mailboxId: string,
		eventName: string,
		lockId: string,
	): Promise<void> {
		const rows = await this.db
			.update(mailboxLockTable)
			.set({ ttl: Math.floor(Date.now() / 1000) + this.leaseSeconds })
			.where(
				and(
					eq(mailboxLockTable.accountId, accountId),
					eq(mailboxLockTable.mailboxId, mailboxId),
					eq(mailboxLockTable.eventName, eventName),
					eq(mailboxLockTable.lockId, lockId),
				),
			)
			.returning();
		if (rows.length === 0) throw new LostLeaseError(mailboxId, eventName);
	}

	async get(
		accountId: string,
		mailboxId: string,
		eventName: string,
	): Promise<MailboxLockItem | null> {
		const [row] = await this.db
			.select()
			.from(mailboxLockTable)
			.where(
				and(
					eq(mailboxLockTable.accountId, accountId),
					eq(mailboxLockTable.mailboxId, mailboxId),
					eq(mailboxLockTable.eventName, eventName),
				),
			);
		return row ? rowToItem(row) : null;
	}

	async listAllLocks(): Promise<MailboxLockItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxLockTable)
			.orderBy(mailboxLockTable.acquiredAt);
		return rows.map(rowToItem);
	}

	async listByAccount(accountId: string): Promise<MailboxLockItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxLockTable)
			.where(eq(mailboxLockTable.accountId, accountId));
		return rows.map(rowToItem);
	}

	async deleteByAccount(accountId: string): Promise<void> {
		await this.db
			.delete(mailboxLockTable)
			.where(eq(mailboxLockTable.accountId, accountId));
	}
}
