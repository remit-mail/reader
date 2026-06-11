/**
 * Connection testing utilities for IMAP and SMTP servers
 *
 * Used to validate credentials before saving account configuration.
 */

import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import type { MailCredentials } from "./types.js";
import { MailConnectionError } from "./types.js";

export interface TestResult {
	success: boolean;
	error?: string;
}

export interface ImapTestConfig {
	host: string;
	port: number;
	secure: boolean;
	credentials: MailCredentials;
	user: string;
}

export interface SmtpTestConfig {
	host: string;
	port: number;
	secure: boolean;
	credentials: MailCredentials;
	user: string;
}

// TODO(#468): Wire OAuth testConnection once authType/oauthRefreshTokenHash are
// available on Account. For OAuth accounts, mint a token via MailOAuthService
// before calling testImapConnection / testSmtpConnection, and map
// RefreshTokenError(reauth-required) to MailConnectionError("auth", ...).

/**
 * Build imapflow auth object from credentials.
 * IMPORTANT: never include accessToken values in error messages.
 */
const buildImapAuth = (
	user: string,
	credentials: MailCredentials,
): { user: string; pass: string } | { user: string; accessToken: string } => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	return { user, accessToken: credentials.accessToken };
};

/**
 * Build nodemailer auth object from credentials.
 */
const buildSmtpAuth = (
	user: string,
	credentials: MailCredentials,
):
	| { user: string; pass: string }
	| { type: "OAuth2"; user: string; accessToken: string } => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	return {
		type: "OAuth2" as const,
		user,
		accessToken: credentials.accessToken,
	};
};

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
		auth: buildImapAuth(config.user, config.credentials),
		logger: false,
	});

	return client
		.connect()
		.then(() => client.logout())
		.then(() => ({ success: true }))
		.catch((error: unknown) => {
			if (error instanceof MailConnectionError) {
				return { success: false, error: error.message };
			}
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		});
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
		auth: buildSmtpAuth(config.user, config.credentials),
	});

	return transport
		.verify()
		.then(() => ({ success: true }))
		.catch((error: unknown) => {
			if (error instanceof MailConnectionError) {
				return { success: false, error: error.message };
			}
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		})
		.finally(() => transport.close());
};
