/**
 * Connection factory for IMAP implementations
 *
 * Uses ImapFlow for all IMAP connections.
 */

import { ImapFlowConnection } from "./imapflow-connection.js";
import type {
	IImapConnection,
	ImapConnectionConfig,
	ImapTransport,
	MailCredentials,
} from "./types.js";

/**
 * Create an IMAP connection
 */
export const createConnection = (
	config: ImapConnectionConfig,
): IImapConnection => {
	return new ImapFlowConnection(config);
};

/**
 * Create an IMAP connection from account data using a MailCredentials union.
 */
export const createConnectionWithCredentials = (
	account: {
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
		username: string;
	},
	credentials: MailCredentials,
	transport: ImapTransport,
): IImapConnection =>
	new ImapFlowConnection({
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
		transport,
		user: account.username,
		credentials,
	});

export interface ConnectionScope {
	getConnection: () => Promise<IImapConnection>;
	disconnect: () => Promise<void>;
}

/**
 * A lazily-connected, cached connection shared across the operations of one
 * unit of work. Call disconnect() when done.
 */
export const connectionScope = (
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
 * Managed connection factory that caches and reuses a single connection.
 *
 * The factory handles connection lifecycle - callers should not disconnect.
 * Call close() on the factory to disconnect when done.
 */
export interface ManagedConnectionFactory {
	/** Get the cached connection (creates on first call) */
	getConnection(): IImapConnection;
	/** Disconnect and cleanup */
	close(): Promise<void>;
}

/**
 * Create a managed connection factory that caches a single connection.
 *
 * @example
 * ```typescript
 * const factory = createManagedConnectionFactory(config);
 * const conn = factory.getConnection();
 * await conn.connect();
 * // ... reuse conn via factory.getConnection() ...
 * await factory.close(); // Disconnect when done
 * ```
 */
export const createManagedConnectionFactory = (
	config: ImapConnectionConfig,
): ManagedConnectionFactory => {
	let connection: ImapFlowConnection | null = null;

	return {
		getConnection: () => {
			if (!connection) {
				connection = new ImapFlowConnection(config);
			}
			return connection;
		},
		close: async () => {
			if (connection) {
				await connection.disconnect();
				connection = null;
			}
		},
	};
};
