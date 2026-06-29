/**
 * Connection scope utility for managing IMAP connections across event processing.
 *
 * Creates a lazily-connected, cached connection that can be shared across
 * multiple operations during a single event's lifetime.
 *
 * On top of the per-event scope, this module keeps a MODULE-scoped pool of warm
 * connections keyed by accountId so a warm Lambda container reuses live IMAP
 * connections across invocations instead of paying TCP+TLS+LOGIN+SELECT every
 * time (see #605).
 */

import {
	createConnection,
	createConnectionWithCredentials,
	type IImapConnection,
	type ImapConnectionConfig,
	type MailCredentials,
} from "@remit/mailbox-service";

export interface ConnectionScope {
	/**
	 * Get the connection, connecting lazily if not already connected.
	 * Returns the same connection instance on subsequent calls.
	 */
	getConnection: () => Promise<IImapConnection>;

	/**
	 * Disconnect the connection if it was ever connected.
	 * Safe to call multiple times.
	 */
	disconnect: () => Promise<void>;
}

/**
 * Create a connection scope that manages a single IMAP connection's lifecycle.
 *
 * The connection is created lazily on first call to getConnection() and
 * reused for all subsequent calls. Call disconnect() when done to clean up.
 *
 * @example
 * ```typescript
 * const scope = createConnectionScope(config);
 *
 * await doWork(scope.getConnection)
 *   .finally(() => scope.disconnect());
 * ```
 */
export const createConnectionScope = (
	config: ImapConnectionConfig,
): ConnectionScope => {
	let connection: IImapConnection | null = null;
	let connectPromise: Promise<IImapConnection> | null = null;

	const getConnection = async (): Promise<IImapConnection> => {
		if (connectPromise) {
			return connectPromise;
		}

		const conn = createConnection(config);
		connection = conn;
		connectPromise = conn.connect().then(() => conn);

		return connectPromise;
	};

	const disconnect = async (): Promise<void> => {
		if (connection) {
			await connection.disconnect();
			connection = null;
			connectPromise = null;
		}
	};

	return { getConnection, disconnect };
};

/**
 * Create a connection scope from account credentials using a password.
 */
export const createConnectionScopeFromAccount = (
	account: {
		username: string;
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
	},
	password: string,
): ConnectionScope => {
	return createConnectionScope({
		user: account.username,
		credentials: { kind: "password", password },
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
	});
};

/**
 * Create a connection scope from account data and a MailCredentials union.
 * Use this for all handlers that support both password and OAuth accounts.
 */
export const createConnectionScopeWithCredentials = (
	account: {
		username: string;
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
	},
	credentials: MailCredentials,
): ConnectionScope => {
	let connection: IImapConnection | null = null;
	let connectPromise: Promise<IImapConnection> | null = null;

	const getConnection = async (): Promise<IImapConnection> => {
		if (connectPromise) {
			return connectPromise;
		}

		const conn = createConnectionWithCredentials(account, credentials);
		connection = conn;
		connectPromise = conn.connect().then(() => conn);

		return connectPromise;
	};

	const disconnect = async (): Promise<void> => {
		if (connection) {
			await connection.disconnect();
			connection = null;
			connectPromise = null;
		}
	};

	return { getConnection, disconnect };
};

/**
 * Number of warm connections to hold per account in a single container.
 *
 * Default 2 (Hostnet-conservative). imapflow runs one command at a time, so a
 * single cached connection cannot be shared by concurrent invocations of the
 * same account in one container (the worker runs handlers under p-map). The
 * pool lets concurrent same-account invocations each borrow a live connection
 * while still reusing them across invocations.
 *
 * CAVEAT: warm reuse only helps WITHIN one container. Lambda may run many
 * containers (each with its own pool) and recycle them, so this cuts login
 * churn but does NOT by itself bound the connections an account opens against
 * the provider — the queue concurrency cap (#610) does that.
 */
const connectionsPerAccount = (() => {
	const raw = Number(process.env.CONNECTIONS_PER_ACCOUNT);
	return Number.isInteger(raw) && raw > 0 ? raw : 2;
})();

/**
 * A pooled, lazily-connected connection plus its liveness/borrow bookkeeping.
 */
interface PooledConnection {
	scope: ConnectionScope;
	/** The established connection once getConnection() has resolved. */
	connection: IImapConnection | null;
	/** Borrowed by an in-flight invocation; must not be lent out concurrently. */
	busy: boolean;
}

/** accountId -> warm pool. Module scope so it survives across invocations. */
const warmPools = new Map<string, PooledConnection[]>();

/**
 * A connection borrowed from the warm pool for the duration of one invocation.
 */
export interface BorrowedConnection {
	/** Get the (possibly cached, liveness-checked) live connection. */
	getConnection: () => Promise<IImapConnection>;
	/**
	 * Return the connection to the pool. Pooled connections stay connected for
	 * reuse; overflow connections (created when the pool is saturated) are
	 * disconnected so the pool never grows past connectionsPerAccount.
	 */
	release: () => Promise<void>;
}

/**
 * A live connection passes liveness when the underlying socket is still
 * authenticated. imapflow flips `isConnected` to false on its `close`/`error`
 * events, which fire when the provider drops an idle socket — the dominant
 * warm-container failure mode. A connection that fails this check is replaced.
 */
const isLive = (entry: PooledConnection): boolean =>
	entry.connection?.isConnected ?? false;

const disconnectQuietly = async (entry: PooledConnection): Promise<void> => {
	try {
		await entry.scope.disconnect();
	} catch {
		// A dead connection may already be gone; reclaiming it must never throw.
	}
};

/**
 * Borrow a warm connection for one invocation, keyed by accountId.
 *
 * Reuses a free, live pooled connection when one exists (no reconnect). A free
 * connection that has gone dead is disconnected and replaced. When every pooled
 * connection is busy and the pool is full, an overflow connection is created and
 * torn down on release so the steady-state pool size stays at
 * connectionsPerAccount.
 *
 * The caller MUST call release() (e.g. in a finally) so the connection returns
 * to the pool; releasing does NOT disconnect a pooled connection.
 */
export const borrowWarmConnection = (
	accountId: string,
	createScope: () => ConnectionScope,
): BorrowedConnection => {
	const pool = warmPools.get(accountId) ?? [];
	if (!warmPools.has(accountId)) {
		warmPools.set(accountId, pool);
	}

	let entry: PooledConnection | undefined;
	let isOverflow = false;

	const claimFreeLiveEntry = (): PooledConnection | undefined => {
		for (const candidate of pool) {
			if (candidate.busy) {
				continue;
			}
			if (isLive(candidate)) {
				candidate.busy = true;
				return candidate;
			}
		}
		return undefined;
	};

	const claimDeadOrEmptyEntry = (): PooledConnection | undefined => {
		for (const candidate of pool) {
			if (!candidate.busy && !isLive(candidate)) {
				// Claim synchronously BEFORE the awaited disconnect in the recycle
				// branch, mirroring claimFreeLiveEntry. Without this, a concurrent
				// same-account borrow could claim the same dead entry during that
				// await and two invocations would share one imapflow connection.
				candidate.busy = true;
				return candidate;
			}
		}
		return undefined;
	};

	const getConnection = async (): Promise<IImapConnection> => {
		if (entry) {
			const conn = await entry.scope.getConnection();
			entry.connection = conn;
			return conn;
		}

		const reused = claimFreeLiveEntry();
		if (reused) {
			entry = reused;
			const conn = await reused.scope.getConnection();
			reused.connection = conn;
			return conn;
		}

		// No free live connection: reuse a dead/never-connected slot if one is
		// free, otherwise grow the pool, otherwise go overflow.
		// claimDeadOrEmptyEntry already set busy=true synchronously, so the
		// recycle slot is fenced off across the awaited disconnect below.
		const recyclable = claimDeadOrEmptyEntry();
		if (recyclable) {
			await disconnectQuietly(recyclable);
			recyclable.scope = createScope();
			recyclable.connection = null;
			entry = recyclable;
		} else if (pool.length < connectionsPerAccount) {
			const fresh: PooledConnection = {
				scope: createScope(),
				connection: null,
				busy: true,
			};
			pool.push(fresh);
			entry = fresh;
		} else {
			isOverflow = true;
			entry = { scope: createScope(), connection: null, busy: true };
		}

		const conn = await entry.scope.getConnection();
		entry.connection = conn;
		return conn;
	};

	const release = async (): Promise<void> => {
		if (!entry) {
			return;
		}
		if (isOverflow) {
			await disconnectQuietly(entry);
			entry = undefined;
			return;
		}
		entry.busy = false;
		entry = undefined;
	};

	return { getConnection, release };
};

/**
 * Test-only: disconnect and drop an account's warm pool so a test never leaks a
 * live connection across cases. Not part of the production lifecycle — in
 * steady state dead entries are recycled lazily on the next borrow.
 */
export const __evictWarmConnectionsForTest = async (
	accountId: string,
): Promise<void> => {
	const pool = warmPools.get(accountId);
	if (!pool) {
		return;
	}
	warmPools.delete(accountId);
	await Promise.all(pool.map(disconnectQuietly));
};

/** Test-only: clear all warm pools without disconnecting (fixtures own teardown). */
export const __resetWarmPoolsForTest = (): void => {
	warmPools.clear();
};

/** Test-only: inspect the live pool size for an account. */
export const __warmPoolSizeForTest = (accountId: string): number =>
	warmPools.get(accountId)?.length ?? 0;
