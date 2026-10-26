import type {
	ConnectionScope,
	IImapConnection,
	MailCredentials,
} from "@remit/mailbox-service";

export type PoolOverflow = "Wait" | "Open";

export interface ConnectionPoolOptions {
	readonly size: number;
	readonly overflow: PoolOverflow;
}

export interface PoolAccount {
	readonly accountId: string;
	readonly username: string;
	readonly imapHost: string;
	readonly imapPort: number;
	readonly imapTls: boolean;
}

export type ConnectImap = (
	account: PoolAccount,
	credentials: MailCredentials,
) => ConnectionScope;

export interface BorrowedConnection {
	getConnection: () => Promise<IImapConnection>;
	release: () => Promise<void>;
}

export interface ConnectionPool {
	borrow: (
		account: PoolAccount,
		credentials: MailCredentials,
	) => BorrowedConnection;
}

interface Slot {
	scope: ConnectionScope;
	connection: IImapConnection | null;
	busy: boolean;
}

type Lease =
	| { kind: "Pooled"; slot: Slot; state: "Live" | "Stale" | "New" }
	| { kind: "Overflow"; slot: Slot };

interface AccountSlots {
	slots: Slot[];
	waiters: Array<(slot: Slot) => void>;
}

const isLive = (slot: Slot): boolean => slot.connection?.isConnected ?? false;

const disconnectQuietly = async (slot: Slot): Promise<void> => {
	await slot.scope.disconnect().catch(() => undefined);
};

export const createConnectionPool = (
	options: ConnectionPoolOptions,
	connect: ConnectImap,
): ConnectionPool => {
	const accounts = new Map<string, AccountSlots>();

	const slotsFor = (accountId: string): AccountSlots => {
		const existing = accounts.get(accountId);
		if (existing) return existing;
		const created: AccountSlots = { slots: [], waiters: [] };
		accounts.set(accountId, created);
		return created;
	};

	const claim = (pool: AccountSlots, createScope: () => ConnectionScope) => {
		const live = pool.slots.find((slot) => !slot.busy && isLive(slot));
		if (live) {
			live.busy = true;
			return { kind: "Pooled", slot: live, state: "Live" } as const;
		}
		const stale = pool.slots.find((slot) => !slot.busy);
		if (stale) {
			stale.busy = true;
			return { kind: "Pooled", slot: stale, state: "Stale" } as const;
		}
		if (pool.slots.length < options.size) {
			const slot: Slot = { scope: createScope(), connection: null, busy: true };
			pool.slots.push(slot);
			return { kind: "Pooled", slot, state: "New" } as const;
		}
		return undefined;
	};

	const giveBack = (pool: AccountSlots, slot: Slot): void => {
		const next = pool.waiters.shift();
		if (next) {
			next(slot);
			return;
		}
		slot.busy = false;
	};

	const acquire = async (
		pool: AccountSlots,
		createScope: () => ConnectionScope,
	): Promise<Lease> => {
		const claimed = claim(pool, createScope);
		if (claimed) return claimed;
		if (options.overflow === "Open") {
			return {
				kind: "Overflow",
				slot: { scope: createScope(), connection: null, busy: true },
			};
		}
		const slot = await new Promise<Slot>((resolve) => {
			pool.waiters.push(resolve);
		});
		return { kind: "Pooled", slot, state: isLive(slot) ? "Live" : "Stale" };
	};

	const borrow = (
		account: PoolAccount,
		credentials: MailCredentials,
	): BorrowedConnection => {
		const pool = slotsFor(account.accountId);
		const createScope = () => connect(account, credentials);
		let leased: Promise<Lease> | undefined;

		const getConnection = async (): Promise<IImapConnection> => {
			leased ??= acquire(pool, createScope).then(async (lease) => {
				if (lease.kind === "Pooled" && lease.state === "Stale") {
					await disconnectQuietly(lease.slot);
					lease.slot.connection = null;
					try {
						lease.slot.scope = createScope();
					} catch (error) {
						giveBack(pool, lease.slot);
						throw error;
					}
				}
				return lease;
			});
			const { slot } = await leased;
			const connection = await slot.scope.getConnection();
			slot.connection = connection;
			return connection;
		};

		const release = async (): Promise<void> => {
			if (!leased) return;
			const pending = leased;
			leased = undefined;
			const lease = await pending.catch(() => undefined);
			if (!lease) return;
			if (lease.kind === "Overflow") {
				await disconnectQuietly(lease.slot);
				return;
			}
			giveBack(pool, lease.slot);
		};

		return { getConnection, release };
	};

	return { borrow };
};
