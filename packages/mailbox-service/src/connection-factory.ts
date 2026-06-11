/**
 * Connection factory for IMAP implementations
 *
 * Uses ImapFlow for all IMAP connections.
 */

import {
	createImapFlowConnectionFromAccount,
	ImapFlowConnection,
} from "./imapflow-connection.js";
import type { IImapConnection, ImapConnectionConfig } from "./types.js";

/**
 * Create an IMAP connection
 */
export const createConnection = (
	config: ImapConnectionConfig,
): IImapConnection => {
	return new ImapFlowConnection(config);
};

/**
 * Create an IMAP connection from account data using password credentials.
 */
export const createConnectionFromAccount = (
	account: {
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
		username: string;
	},
	password: string,
): IImapConnection => {
	return createImapFlowConnectionFromAccount(account, password);
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
