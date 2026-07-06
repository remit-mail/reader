/**
 * Connection testing utilities for IMAP and SMTP servers
 *
 * Used to validate credentials before saving account configuration.
 */

import { createConnection as createNetConnection } from "node:net";
import { connect as tlsConnect } from "node:tls";
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
	startTls?: boolean;
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

const TEST_TIMEOUT_MS = 12_000;

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
 * Test IMAP connection with provided credentials.
 *
 * Uses a raw socket to send AUTH PLAIN directly — bypasses the CAPABILITY
 * round-trip that IMAP clients typically perform first, avoiding deadlocks
 * with servers that pipeline their tagged responses.
 *
 * Supports plaintext, direct TLS (secure: true), and STARTTLS (startTls: true).
 */
export const testImapConnection = async (
	config: ImapTestConfig,
): Promise<TestResult> => {
	if (config.credentials.kind !== "password") {
		return { success: false, error: "OAuth not supported for connection test" };
	}

	const { user, credentials } = config;
	const authPlain = Buffer.from(
		`\x00${user}\x00${credentials.password}`,
	).toString("base64");

	return new Promise((resolve) => {
		let settled = false;
		const done = (result: TestResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			resolve(result);
		};

		const timeoutId = setTimeout(
			() => done({ success: false, error: "Connection timed out" }),
			TEST_TIMEOUT_MS,
		);

		let buf = "";
		let phase: "greeting" | "starttls" | "tls-upgrade" | "auth" | "done" =
			"greeting";
		// biome-ignore lint/suspicious/noExplicitAny: socket type varies between net.Socket and tls.TLSSocket
		let sock: any;

		const onData = (chunk: Buffer) => {
			buf += chunk.toString();
			const lines = buf.split("\r\n");
			buf = lines.pop() ?? "";

			for (const line of lines) {
				if (phase === "greeting" && /^\* OK/i.test(line)) {
					if (config.startTls) {
						phase = "starttls";
						sock.write("A001 STARTTLS\r\n");
					} else {
						phase = "auth";
						sock.write(`A001 AUTHENTICATE PLAIN ${authPlain}\r\n`);
					}
				} else if (phase === "starttls" && /^A001 OK/i.test(line)) {
					phase = "tls-upgrade";
					// Upgrade socket to TLS in place
					const tlsSock = tlsConnect({
						socket: sock,
						host: config.host,
						rejectUnauthorized: false,
					});
					tlsSock.on("data", onData);
					tlsSock.on("error", onError);
					tlsSock.once("secureConnect", () => {
						phase = "auth";
						sock = tlsSock;
						sock.write(`A002 AUTHENTICATE PLAIN ${authPlain}\r\n`);
					});
				} else if (
					phase === "auth" &&
					(/^A00[12] OK/i.test(line) || /^A001 OK/i.test(line))
				) {
					phase = "done";
					sock.write("A099 LOGOUT\r\n");
					done({ success: true });
				} else if (
					phase === "auth" &&
					(/^A00[12] NO/i.test(line) || /^A00[12] BAD/i.test(line))
				) {
					phase = "done";
					sock.destroy();
					done({ success: false, error: "Authentication failed" });
				}
			}
		};

		const onError = (err: Error) => {
			done({ success: false, error: err.message });
		};

		if (config.secure) {
			sock = tlsConnect({
				host: config.host,
				port: config.port,
				rejectUnauthorized: false,
			});
		} else {
			sock = createNetConnection({ host: config.host, port: config.port });
		}

		sock.on("data", onData);
		sock.on("error", onError);
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
		connectionTimeout: TEST_TIMEOUT_MS,
		greetingTimeout: TEST_TIMEOUT_MS,
		socketTimeout: TEST_TIMEOUT_MS,
	});

	const attempt = transport
		.verify()
		.then(() => ({ success: true as const }))
		.catch((error: unknown) => {
			if (error instanceof MailConnectionError) {
				return { success: false as const, error: error.message };
			}
			return {
				success: false as const,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		})
		.finally(() => transport.close());

	const timeout = new Promise<TestResult>((resolve) =>
		setTimeout(() => {
			transport.close();
			resolve({ success: false, error: "Connection timed out" });
		}, TEST_TIMEOUT_MS),
	);

	return Promise.race([attempt, timeout]);
};
