/**
 * Connection testing utilities for IMAP and SMTP servers
 *
 * Used to validate credentials before saving account configuration.
 */

import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

export interface TestResult {
	success: boolean;
	error?: string;
}

export interface ImapTestConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: { user: string; pass: string };
}

export interface SmtpTestConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: { user: string; pass: string };
}

/**
 * Test IMAP connection with provided credentials
 *
 * Attempts to connect and immediately logout to verify credentials work.
 */
export const testImapConnection = async (
	config: ImapTestConfig,
): Promise<TestResult> => {
	const client = new ImapFlow({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.auth,
		logger: false,
	});

	return client
		.connect()
		.then(() => client.logout())
		.then(() => ({ success: true }))
		.catch((error: unknown) => ({
			success: false,
			error: error instanceof Error ? error.message : "Connection failed",
		}));
};

/**
 * Test SMTP connection with provided credentials
 *
 * Uses nodemailer's verify() method to test authentication.
 */
export const testSmtpConnection = async (
	config: SmtpTestConfig,
): Promise<TestResult> => {
	const transport = createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.auth,
	});

	return transport
		.verify()
		.then(() => ({ success: true }))
		.catch((error: unknown) => ({
			success: false,
			error: error instanceof Error ? error.message : "Connection failed",
		}))
		.finally(() => transport.close());
};
