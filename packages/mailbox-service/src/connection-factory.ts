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
