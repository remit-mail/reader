/**
 * Puts mail on the server the way a real correspondent would: an IMAP APPEND of
 * a complete RFC 5322 message. Nothing writes to the maildir behind Dovecot's
 * back, so the app sees exactly what it would see against any IMAP host.
 *
 * Every call names the mailbox it acts on. The suite has no ambient "the test
 * mailbox" — each run owns a different one.
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

const rfc5322 = (message: Message, recipient: string): string => {
	const from = message.from ?? "Correspondent <sender@remit.test>";
	const to = message.to ?? recipient;
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

const connect = async (user: string): Promise<ImapFlow> => {
	const client = new ImapFlow({
		host: imap.host,
		port: imap.port,
		secure: false,
		auth: { user, pass: imap.password },
		logger: false,
	});
	await client.connect();
	return client;
};

/** APPEND messages to a mailbox and return the subjects that were written. */
export const appendMessages = async (
	user: string,
	messages: Message[],
	mailbox = "INBOX",
): Promise<string[]> => {
	const client = await connect(user);
	try {
		for (const message of messages) {
			await client.append(mailbox, Buffer.from(rfc5322(message, user)));
		}
	} finally {
		await client.logout();
	}
	return messages.map((message) => message.subject);
};

/** The mailboxes Dovecot itself reports — the ground truth a sync is measured against. */
export const listServerMailboxes = async (user: string): Promise<string[]> => {
	const client = await connect(user);
	try {
		const list = await client.list();
		return list.map((entry) => entry.path);
	} finally {
		await client.logout();
	}
};

/** The subjects Dovecot holds in a mailbox, for asserting against what synced. */
export const listServerSubjects = async (
	user: string,
	mailbox = "INBOX",
): Promise<string[]> => {
	const client = await connect(user);
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			// FETCH 1:* is a protocol error against an empty mailbox, which is the
			// normal state for a mailbox a run has just claimed.
			const exists =
				typeof client.mailbox === "object" ? client.mailbox.exists : 0;
			if (!exists) return [];

			const subjects: string[] = [];
			for await (const message of client.fetch("1:*", { envelope: true })) {
				subjects.push(message.envelope?.subject ?? "");
			}
			return subjects;
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
};
