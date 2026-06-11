/**
 * Connection scope utility for managing IMAP connections across event processing.
 *
 * Creates a lazily-connected, cached connection that can be shared across
 * multiple operations during a single event's lifetime.
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
