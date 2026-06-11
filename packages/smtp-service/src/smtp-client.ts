import nodemailer from "nodemailer";
import type { MailMessage } from "./message-builder.js";

/**
 * Discriminated union of SMTP authentication credentials.
 *
 * Mirrors MailCredentials in remit-mailbox-service. Defined here to avoid a
 * cross-package dependency — smtp-service does not depend on mailbox-service.
 */
export type SmtpCredentials =
	| { kind: "password"; password: string }
	| { kind: "accessToken"; accessToken: string };

/**
 * Classification of SMTP connection / send errors.
 */
export type SmtpErrorKind = "auth" | "network";

/**
 * Typed error for SMTP authentication and network failures.
 *
 * IMPORTANT: access tokens must NEVER appear in error messages.
 */
export class SmtpConnectionError extends Error {
	readonly kind: SmtpErrorKind;

	constructor(kind: SmtpErrorKind, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "SmtpConnectionError";
		this.kind = kind;
	}
}

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean; // true for TLS (465), false for STARTTLS (587)
	credentials: SmtpCredentials;
	user: string;
	tls?: {
		rejectUnauthorized?: boolean; // false to accept self-signed certs (testing only)
	};
	connectionTimeout?: number; // milliseconds, default 30000
}

export interface SendResult {
	success: boolean;
	messageId?: string;
	response?: string;
	error?: Error;
	smtpCode?: number;
	isTransient: boolean;
}

/**
 * Build nodemailer auth from SmtpCredentials.
 * IMPORTANT: never include accessToken values in error messages.
 */
const buildSmtpAuth = (
	user: string,
	credentials: SmtpCredentials,
):
	| { user: string; pass: string }
	| { type: "OAuth2"; user: string; accessToken: string } => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	if (credentials.kind === "accessToken") {
		return {
			type: "OAuth2" as const,
			user,
			accessToken: credentials.accessToken,
		};
	}
	// Exhaustiveness check — fails to compile if a new credential kind is added
	// without handling it here.
	const _exhaustive: never = credentials;
	throw new Error(`Unknown credential kind: ${JSON.stringify(_exhaustive)}`);
};

/**
 * Send email via SMTP using Nodemailer
 */
export const sendMail = async (
	config: SmtpConfig,
	message: MailMessage,
): Promise<SendResult> => {
	const timeout = config.connectionTimeout ?? 30_000;
	const transporter = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: buildSmtpAuth(config.user, config.credentials),
		tls: config.tls,
		connectionTimeout: timeout,
		greetingTimeout: timeout,
		socketTimeout: 300_000,
	});

	return transporter
		.sendMail({
			from: message.from,
			to: message.to,
			cc: message.cc,
			bcc: message.bcc,
			replyTo: message.replyTo,
			subject: message.subject,
			text: message.text,
			html: message.html,
			messageId: message.messageId,
			inReplyTo: message.inReplyTo,
			references: message.references,
			attachments: message.attachments?.map((a) => ({
				filename: a.filename,
				content: a.content as Buffer,
				contentType: a.contentType,
				cid: a.cid,
				contentDisposition: a.contentDisposition,
			})),
		})
		.then((info) => ({
			success: true,
			messageId: info.messageId,
			response: info.response,
			isTransient: false,
		}))
		.catch(
			(
				error: Error & {
					responseCode?: number;
					code?: string;
					command?: string;
				},
			) => {
				const smtpCode = error.responseCode;

				// Classify auth errors — EAUTH or 5xx on AUTH command
				if (
					error.code === "EAUTH" ||
					(smtpCode !== undefined &&
						smtpCode >= 500 &&
						error.command === "AUTH")
				) {
					throw new SmtpConnectionError(
						"auth",
						"SMTP authentication failed",
						error,
					);
				}

				// Classify network errors
				if (
					error.code === "ECONNREFUSED" ||
					error.code === "ETIMEDOUT" ||
					error.code === "ENOTFOUND" ||
					error.code === "ECONNRESET" ||
					error.code === "EHOSTUNREACH"
				) {
					throw new SmtpConnectionError(
						"network",
						`SMTP connection failed: ${error.code}`,
						error,
					);
				}

				// 4xx = transient (retry), 5xx = permanent (no retry)
				const isTransient =
					smtpCode !== undefined && smtpCode >= 400 && smtpCode < 500;
				return {
					success: false,
					error,
					smtpCode,
					isTransient,
				};
			},
		)
		.finally(() => transporter.close());
};
