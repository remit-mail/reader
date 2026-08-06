/**
 * Puts mail on the server the way a real correspondent would: an IMAP APPEND of
 * a complete RFC 5322 message. Nothing writes to the maildir behind Dovecot's
 * back, so the app sees exactly what it would see against any IMAP host.
 *
 * Every call names the mailbox it acts on. The suite has no ambient "the test
 * mailbox" — each run owns a different one.
 */
import { ImapFlow } from "imapflow";
import { waitFor } from "./api.js";
import { imap } from "./env.js";

export interface Message {
	subject: string;
	from?: string;
	to?: string;
	body?: string;
	messageIdHeader?: string;
	date?: Date;
	/** The Message-ID this message replies to, as RFC 5322 In-Reply-To. */
	inReplyTo?: string;
	/** The reply chain, root first, as RFC 5322 References. */
	references?: string[];
	/**
	 * Extra header lines, written verbatim above the body in the order given.
	 * This is how a spec reproduces the mail a real bulk sender emits —
	 * `List-Unsubscribe`, `List-ID`, `Precedence`, `DKIM-Signature` — which is
	 * what the classifier reads and what a synthetic one-header fixture cannot
	 * express.
	 *
	 * A list of pairs rather than an object: real mail repeats header names
	 * (several `DKIM-Signature` lines, several `Received` lines), and the order
	 * of those repeats is part of what is under test. An object can express
	 * neither.
	 */
	headers?: ReadonlyArray<readonly [name: string, value: string]>;
	/**
	 * The body's media type, e.g. `text/html`. Defaults to `text/plain`, which
	 * is what most of the suite wants; a spec that is about how markup renders
	 * says so here rather than smuggling a second Content-Type through
	 * `headers`.
	 */
	contentType?: "text/plain" | "text/html";
	/**
	 * IMAP keywords to set at APPEND time, e.g. `["\\Flagged"]`. This is how mail
	 * arrives already flagged from another client — the state exists on the
	 * server before the app has ever seen the message, so a sync that ignores it
	 * loses the star rather than displaying it wrong.
	 */
	flags?: string[];
}

const rfc5322 = (message: Message, recipient: string): string => {
	const from = message.from ?? "Correspondent <sender@remit.test>";
	const to = message.to ?? recipient;
	const date = (message.date ?? new Date()).toUTCString();
	const messageId =
		message.messageIdHeader ??
		`<${Math.random().toString(36).slice(2)}@remit.test>`;
	const extra = (message.headers ?? []).map(
		([name, value]) => `${name}: ${value}`,
	);
	return [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${message.subject}`,
		`Date: ${date}`,
		`Message-ID: ${messageId}`,
		...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
		...(message.references?.length
			? [`References: ${message.references.join(" ")}`]
			: []),
		...extra,
		"MIME-Version: 1.0",
		`Content-Type: ${message.contentType ?? "text/plain"}; charset="utf-8"`,
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
			await client.append(
				mailbox,
				Buffer.from(rfc5322(message, user)),
				message.flags,
			);
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

/**
 * The UIDs Dovecot holds for one subject in a mailbox.
 *
 * A UID is the message's identity on the server, and IMAP has no in-place MOVE:
 * anything that moves a message re-appends it under a fresh UID. So this is how
 * a spec asks whether the server was touched at all, which "is it still there"
 * cannot answer.
 */
export const serverUidsForSubject = async (
	user: string,
	mailbox: string,
	subject: string,
): Promise<number[]> => {
	const client = await connect(user);
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			const exists =
				typeof client.mailbox === "object" ? client.mailbox.exists : 0;
			if (!exists) return [];

			const uids: number[] = [];
			for await (const message of client.fetch("1:*", { envelope: true })) {
				if (message.envelope?.subject === subject) uids.push(message.uid);
			}
			return uids;
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
};

/**
 * The IMAP flags (system flags and keywords alike — `\Seen`, `$Junk`,
 * `$NotJunk`, …) Dovecot holds for one subject in a mailbox. Empty when the
 * subject is not present. Used to prove an outbound flag push actually
 * reached the server, not just the read model.
 */
export const serverFlagsForSubject = async (
	user: string,
	mailbox: string,
	subject: string,
): Promise<string[]> => {
	const client = await connect(user);
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			const exists =
				typeof client.mailbox === "object" ? client.mailbox.exists : 0;
			if (!exists) return [];

			for await (const message of client.fetch("1:*", {
				envelope: true,
				flags: true,
			})) {
				if (message.envelope?.subject === subject) {
					return message.flags ? [...message.flags] : [];
				}
			}
			return [];
		} finally {
			lock.release();
		}
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

/**
 * Poll Dovecot until a mailbox's contents satisfy `accept`.
 *
 * A move or a delete is answered once the read model has been updated; the IMAP
 * write is queued behind that answer. So a wait on the API is a wait on the
 * client's projection, and it settles while the server still holds the message
 * where it was. The next sync re-derives the mailbox from the server and
 * restores what the projection had already dropped — which is how one spec's
 * cleanup surfaces as an extra row in a later spec's mailbox.
 *
 * Anything that has to still hold after the spec ends waits here.
 */
export const waitForServerMailbox = (
	user: string,
	mailbox: string,
	accept: (subjects: string[]) => boolean,
	{ timeoutMs = 60_000, what }: { timeoutMs?: number; what: string },
): Promise<string[]> =>
	waitFor(() => listServerSubjects(user, mailbox), accept, {
		timeoutMs,
		what: `${what} on the mail server`,
	});
