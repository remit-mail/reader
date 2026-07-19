/**
 * Puts mail on the server the way a real correspondent would: an IMAP APPEND of
 * a complete RFC 5322 message. Nothing writes to the maildir behind Dovecot's
 * back, so the app sees exactly what it would see against any IMAP host.
 */
import { ImapFlow } from "imapflow";
import { imap } from "./env.js";

export interface Message {
	subject: string;
	from?: string;
	to?: string;
	body?: string;
	messageIdHeader?: string;
	date?: Date;
}

const rfc5322 = (message: Message): string => {
	const from = message.from ?? "Correspondent <sender@remit.test>";
	const to = message.to ?? imap.user;
	const date = (message.date ?? new Date()).toUTCString();
	const messageId =
		message.messageIdHeader ??
		`<${Math.random().toString(36).slice(2)}@remit.test>`;
	return [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${message.subject}`,
		`Date: ${date}`,
		`Message-ID: ${messageId}`,
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="utf-8"',
		"",
		message.body ?? `Body of ${message.subject}.`,
		"",
	].join("\r\n");
};

const connect = async (): Promise<ImapFlow> => {
	const client = new ImapFlow({
		host: imap.host,
		port: imap.port,
		secure: false,
		auth: { user: imap.user, pass: imap.password },
		logger: false,
	});
	await client.connect();
	return client;
};

/** APPEND messages to a mailbox and return the subjects that were written. */
export const appendMessages = async (
	messages: Message[],
	mailbox = "INBOX",
): Promise<string[]> => {
	const client = await connect();
	try {
		for (const message of messages) {
			await client.append(mailbox, Buffer.from(rfc5322(message)));
		}
	} finally {
		await client.logout();
	}
	return messages.map((message) => message.subject);
};

/** The mailboxes Dovecot itself reports — the ground truth a sync is measured against. */
export const listServerMailboxes = async (): Promise<string[]> => {
	const client = await connect();
	try {
		const list = await client.list();
		return list.map((entry) => entry.path);
	} finally {
		await client.logout();
	}
};
