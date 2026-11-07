import type {
	IMailboxLockRepository,
	MailboxLockItem,
	WithMailboxLockResult,
} from "@remit/data-ports";
import { and, eq, lt } from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { randomId } from "../id.js";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";

type DB = RepositoryDb<Record<string, unknown>>;

// A holder that dies mid-operation (an evicted Durable Object, a killed Lambda)
// never releases its lock, so the lock is a lease the live holder keeps renewing
// and a dead holder's lease lapses within the lease.
export interface Lease {
	readonly seconds: number;
	readonly renewEveryMs: number;
}

const LEASE: Lease = { seconds: 60, renewEveryMs: 20_000 };

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
		private lease: Lease = LEASE,
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
		operation: () => Promise<T>,
		options?: { lockId?: string },
	): Promise<WithMailboxLockResult<T>> {
		const lockId = options?.lockId ?? randomId();

		const acquired = await this.tryAcquireLock(
			mailboxId,
			eventName,
			accountId,
			lockId,
			this.lease.seconds,
		);
		if (!acquired) return { executed: false };

		let renewal: Promise<void> = Promise.resolve();
		let renewalError: unknown;
		const timer = setInterval(() => {
			renewal = renewal
				.then(() => this.renewLock(accountId, mailboxId, eventName, lockId))
				.catch((error: unknown) => {
					renewalError ??= error;
				});
		}, this.lease.renewEveryMs);

		return operation()
			.then((result) => ({ executed: true as const, result }))
			.finally(async () => {
				clearInterval(timer);
				await renewal;
				await this.releaseLock(accountId, mailboxId, eventName, lockId);
				if (renewalError !== undefined) throw renewalError;
			});
	}

	private async renewLock(
		accountId: string,
		mailboxId: string,
		eventName: string,
		lockId: string,
	): Promise<void> {
		await this.db
			.update(mailboxLockTable)
			.set({ ttl: Math.floor(Date.now() / 1000) + this.lease.seconds })
			.where(
				and(
					eq(mailboxLockTable.accountId, accountId),
					eq(mailboxLockTable.mailboxId, mailboxId),
					eq(mailboxLockTable.eventName, eventName),
					eq(mailboxLockTable.lockId, lockId),
				),
			);
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
