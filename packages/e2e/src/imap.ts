/**
 * Puts mail on the server the way a real correspondent would: an IMAP APPEND of
 * a complete RFC 5322 message. Nothing writes to the maildir behind Dovecot's
 * back, so the app sees exactly what it would see against any IMAP host.
 *
 * Every call names the mailbox it acts on. The suite has no ambient "the test
 * mailbox" — each run owns a different one.
 */
import type { MessageStructureObject } from "imapflow";
import { ImapFlow } from "imapflow";
import { waitFor } from "./api.js";
import { imap, mintImapUser } from "./env.js";

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
	/**
	 * Files hung off the message as `Content-Disposition: attachment` parts.
	 * When present the message is emitted as `multipart/mixed`, which is what a
	 * real correspondent's mail client produces and what the app has to walk to
	 * find anything downloadable.
	 */
	attachments?: ReadonlyArray<{
		filename: string;
		contentType: string;
		content: string;
	}>;
}

const MIME_BOUNDARY = "remit-e2e-boundary";

/** RFC 5322 caps a line at 998 octets; RFC 2045 asks base64 for 76. */
const wrapBase64 = (encoded: string): string[] =>
	encoded.match(/.{1,76}/g) ?? [""];

const attachmentPart = (attachment: {
	filename: string;
	contentType: string;
	content: string;
}): string[] => [
	`--${MIME_BOUNDARY}`,
	`Content-Type: ${attachment.contentType}`,
	"Content-Transfer-Encoding: base64",
	`Content-Disposition: attachment; filename="${attachment.filename}"`,
	"",
	...wrapBase64(Buffer.from(attachment.content, "utf8").toString("base64")),
	"",
];

const multipartBody = (message: Message): string[] => {
	const attachments = message.attachments ?? [];
	return [
		`--${MIME_BOUNDARY}`,
		`Content-Type: ${message.contentType ?? "text/plain"}; charset="utf-8"`,
		"",
		message.body ?? `Body of ${message.subject}.`,
		"",
		...attachments.flatMap(attachmentPart),
		`--${MIME_BOUNDARY}--`,
		"",
	];
};

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
		...(message.attachments?.length
			? [
					`Content-Type: multipart/mixed; boundary="${MIME_BOUNDARY}"`,
					"",
					...multipartBody(message),
				]
			: [
					`Content-Type: ${message.contentType ?? "text/plain"}; charset="utf-8"`,
					"",
					message.body ?? `Body of ${message.subject}.`,
					"",
				]),
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

/**
 * One entry of the server's own LIST: the path, the delimiter that path is
 * composed with, and the SPECIAL-USE the server advertises for it. A spec about
 * how a folder resolves to a role reads this to prove its fixture is what it
 * claims — an unflagged folder that turned out to carry a flag would pass the
 * assertion for the wrong reason.
 */
export interface ServerMailbox {
	path: string;
	delimiter: string;
	specialUse?: string;
}

/** The mailboxes Dovecot itself reports — the ground truth a sync is measured against. */
export const describeServerMailboxes = async (
	user: string,
): Promise<ServerMailbox[]> => {
	const client = await connect(user);
	try {
		const list = await client.list();
		return list.map((entry) => ({
			path: entry.path,
			delimiter: entry.delimiter,
			specialUse: entry.specialUse,
		}));
	} finally {
		await client.logout();
	}
};

/** The paths of {@link describeServerMailboxes}, for a spec that only compares sets. */
export const listServerMailboxes = async (user: string): Promise<string[]> => {
	const mailboxes = await describeServerMailboxes(user);
	return mailboxes.map((mailbox) => mailbox.path);
};

/**
 * CREATE a folder on the server, the way another mail client would — so the app
 * learns the path and its delimiter from LIST rather than from its own write.
 */
export const createServerMailbox = async (
	user: string,
	path: string,
): Promise<void> => {
	const client = await connect(user);
	try {
		await client.mailboxCreate(path);
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

/** APPEND a complete message the caller already has as bytes, e.g. one read back off the wire. */
export const appendRawMessage = async (
	user: string,
	raw: string,
	mailbox = "INBOX",
): Promise<void> => {
	const client = await connect(user);
	try {
		await client.append(mailbox, Buffer.from(raw));
	} finally {
		await client.logout();
	}
};

/**
 * The complete RFC 5322 source Dovecot holds for one subject in a mailbox, or
 * null when the subject is not there.
 *
 * The envelope and the flags say what the server made of a message; this is the
 * message. A spec about what was actually composed — which parts exist, what
 * each one carries — has nothing else to read.
 */
export const serverRawSourceForSubject = async (
	user: string,
	mailbox: string,
	subject: string,
): Promise<string | null> => {
	const client = await connect(user);
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			const exists =
				typeof client.mailbox === "object" ? client.mailbox.exists : 0;
			if (!exists) return null;

			for await (const message of client.fetch("1:*", {
				envelope: true,
				source: true,
			})) {
				if (message.envelope?.subject === subject) {
					return message.source?.toString("utf8") ?? null;
				}
			}
			return null;
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
};

/** One leaf of a MIME tree: a body part and the text it decodes to. */
export interface MimePart {
	contentType: string;
	content: string;
}

/**
 * A message's MIME shape as the server parsed it: the top-level media type and
 * every leaf part under it, in order.
 */
export interface MimeShape {
	contentType: string;
	parts: MimePart[];
}

const leafNodes = (
	node: MessageStructureObject,
): Array<{ part: string; type: string }> => {
	if (!node.childNodes?.length) {
		// A single-part message has no part number at all; ImapFlow maps "1" onto
		// the whole body for exactly that case.
		return [{ part: node.part ?? "1", type: node.type }];
	}
	return node.childNodes.flatMap(leafNodes);
};

const readStream = async (stream: NodeJS.ReadableStream): Promise<string> => {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
};

interface StructuredMessage {
	uid: number;
	structure: MessageStructureObject;
}

/**
 * Download every leaf of one message and pair each with the media type
 * BODYSTRUCTURE gave it.
 *
 * The FETCH that found the message is drained before the first download starts.
 * A connection carries one command at a time, so issuing a download from inside
 * an unfinished FETCH would wait on a response that cannot arrive.
 */
const downloadShape = async (
	client: ImapFlow,
	message: StructuredMessage,
): Promise<MimeShape> => {
	const parts: MimePart[] = [];
	for (const leaf of leafNodes(message.structure)) {
		const download = await client.download(String(message.uid), leaf.part, {
			uid: true,
		});
		parts.push({
			contentType: leaf.type,
			content: await readStream(download.content),
		});
	}
	return { contentType: message.structure.type, parts };
};

const firstStructured = async (
	client: ImapFlow,
	matches: (subject: string | undefined) => boolean,
): Promise<StructuredMessage | null> => {
	const exists = typeof client.mailbox === "object" ? client.mailbox.exists : 0;
	if (!exists) return null;

	let found: StructuredMessage | null = null;
	for await (const message of client.fetch("1:*", {
		envelope: true,
		bodyStructure: true,
	})) {
		if (found || !message.bodyStructure) continue;
		if (!matches(message.envelope?.subject)) continue;
		found = { uid: message.uid, structure: message.bodyStructure };
	}
	return found;
};

/**
 * The MIME shape of one subject in a mailbox, parsed by Dovecot rather than by
 * the suite: the structure comes from BODYSTRUCTURE and each part's text from a
 * FETCH the server transfer-decodes.
 *
 * Using the mail server as the parser is what makes an agreement assertion
 * worth something. Two messages built by two different code paths are compared
 * through one reader that knows nothing about either.
 */
export const readMimeShape = async (
	user: string,
	mailbox: string,
	subject: string,
): Promise<MimeShape | null> => {
	const client = await connect(user);
	try {
		const lock = await client.getMailboxLock(mailbox);
		try {
			const found = await firstStructured(client, (seen) => seen === subject);
			return found ? await downloadShape(client, found) : null;
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
};

/**
 * The MIME shape of a message the caller holds as bytes.
 *
 * It is parked in a mailbox nobody else will ever touch and read straight back,
 * so bytes off the wire and bytes out of a Sent folder go through the same
 * reader and can be compared part for part.
 */
export const readMimeShapeOfRaw = async (raw: string): Promise<MimeShape> => {
	const scratchUser = mintImapUser();
	await appendRawMessage(scratchUser, raw);
	const client = await connect(scratchUser);
	try {
		const lock = await client.getMailboxLock("INBOX");
		try {
			const found = await firstStructured(client, () => true);
			if (!found) {
				throw new Error(
					"the scratch mailbox did not hold the appended message",
				);
			}
			return await downloadShape(client, found);
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
};
