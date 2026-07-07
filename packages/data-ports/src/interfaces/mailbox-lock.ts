import type { MailboxLockItem, WithMailboxLockResult } from "../types.js";

export interface IMailboxLockRepository {
	tryAcquireLock(
		mailboxId: string,
		eventName: string,
		accountId: string,
		lockId: string,
	): Promise<boolean>;
	releaseLock(
		accountId: string,
		mailboxId: string,
		eventName: string,
		lockId: string,
	): Promise<void>;
	withMailboxLock<T>(
		mailboxId: string,
		eventName: string,
		accountId: string,
		operation: () => Promise<T>,
		options?: { lockId?: string },
	): Promise<WithMailboxLockResult<T>>;
	get(
		accountId: string,
		mailboxId: string,
		eventName: string,
	): Promise<MailboxLockItem | null>;
	listAllLocks(): Promise<MailboxLockItem[]>;
	listByAccount(accountId: string): Promise<MailboxLockItem[]>;
	deleteByAccount(accountId: string): Promise<void>;
}
