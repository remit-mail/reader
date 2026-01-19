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
 * Create an IMAP connection from account data
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
