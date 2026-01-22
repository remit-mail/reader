import nodemailer from "nodemailer";
import type { MailMessage } from "./message-builder.js";

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean; // true for TLS (465), false for STARTTLS (587)
	auth: {
		user: string;
		pass: string;
	};
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
		auth: config.auth,
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
		.catch((error: Error & { responseCode?: number }) => {
			const code = error.responseCode;
			// 4xx = transient (retry), 5xx = permanent (no retry)
			const isTransient = code !== undefined && code >= 400 && code < 500;
			return {
				success: false,
				error,
				smtpCode: code,
				isTransient,
			};
		})
		.finally(() => transporter.close());
};
