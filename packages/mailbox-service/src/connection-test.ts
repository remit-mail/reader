import type { TestResult } from "@remit/data-ports";
import { ImapFlowConnection } from "./imapflow-connection.js";
import type { ImapTransport, MailCredentials } from "./types.js";

export interface ImapTestConfig {
	host: string;
	port: number;
	secure: boolean;
	credentials: MailCredentials;
	user: string;
}

const TEST_TIMEOUT_MS = 12_000;

export const testImapConnection = async (
	config: ImapTestConfig,
	transport: ImapTransport,
): Promise<TestResult> => {
	const connection = new ImapFlowConnection({
		host: config.host,
		port: config.port,
		tls: config.secure,
		user: config.user,
		credentials: config.credentials,
		transport,
		connTimeout: TEST_TIMEOUT_MS,
	});

	const result = await connection.connectOnce().then(
		(): TestResult => ({ success: true }),
		(error: unknown): TestResult => ({
			success: false,
			error: error instanceof Error ? error.message : "Connection failed",
		}),
	);
	await connection.disconnect();
	return result;
};
