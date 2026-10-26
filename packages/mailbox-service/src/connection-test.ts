import { createConnection } from "./connection-factory.js";
import type { ImapTransport, MailCredentials } from "./types.js";

export type TestResult = { success: true } | { success: false; error: string };

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
	const connection = createConnection({
		host: config.host,
		port: config.port,
		tls: config.secure,
		user: config.user,
		credentials: config.credentials,
		transport,
	});

	const timedOut: TestResult = {
		success: false,
		error: "Connection timed out",
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<TestResult>((resolve) => {
		timer = setTimeout(() => resolve(timedOut), TEST_TIMEOUT_MS);
	});

	const attempt = connection.connect().then(
		(): TestResult => ({ success: true }),
		(error: unknown): TestResult => ({
			success: false,
			error: error instanceof Error ? error.message : "Connection failed",
		}),
	);
	const closed = attempt.then(() => connection.disconnect());

	const result = await Promise.race([attempt, timeout]);
	clearTimeout(timer);
	if (result !== timedOut) await closed;
	return result;
};
