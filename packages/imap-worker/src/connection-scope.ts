import {
	type ConnectionScope,
	connectionScope,
	type MailCredentials,
} from "@remit/mailbox-service";
import { nodeTransport } from "@remit/mailbox-service/node-transport";

export type { ConnectionScope };

export const createConnectionScopeWithCredentials = (
	account: {
		username: string;
		imapHost: string;
		imapPort: number;
		imapTls: boolean;
	},
	credentials: MailCredentials,
): ConnectionScope =>
	connectionScope({
		host: account.imapHost,
		port: account.imapPort,
		tls: account.imapTls,
		user: account.username,
		credentials,
		transport: nodeTransport(),
	});
