import type { OutboxMessageItem } from "@remit/data-ports";
import nodemailer, { type SendMailOptions } from "nodemailer";

export interface MailMessage {
	from: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	replyTo?: string;
	subject?: string;
	text?: string;
	html?: string;
	messageId: string;
	inReplyTo?: string;
	references?: string;
	date?: Date;
	attachments?: MailAttachment[];
}

export interface MailAttachment {
	filename: string;
	content: Buffer;
	contentType: string;
	cid?: string;
	contentDisposition?: "attachment" | "inline";
}

// Nodemailer parses the From string back into a name and an address, so a
// display name carrying a quote or a backslash has to survive that round trip.
const formatFrom = (address: string, name: string | undefined): string =>
	name ? `"${name.replace(/(["\\])/g, "\\$1")}" <${address}>` : address;

/**
 * The one description of an outgoing message. Both copies come from here: the
 * bytes SMTP puts on the wire and the bytes APPENDed to Sent.
 */
export const buildMailMessage = (
	outbox: OutboxMessageItem,
	attachments?: MailAttachment[],
): MailMessage => ({
	from: formatFrom(outbox.fromAddress, outbox.fromName),
	to: outbox.toAddresses,
	cc: outbox.ccAddresses,
	bcc: outbox.bccAddresses,
	replyTo: outbox.replyToAddress,
	subject: outbox.subject,
	text: outbox.textBody,
	html: outbox.htmlBody,
	messageId: `<${outbox.messageIdValue}>`,
	inReplyTo: outbox.inReplyTo ? `<${outbox.inReplyTo}>` : undefined,
	references: outbox.references?.map((r) => `<${r}>`).join(" "),
	// Only the Sent copy has one to carry: the row is stamped after the
	// submission is accepted, so on the wire path this is always absent and
	// nodemailer dates the message as it goes out.
	date: outbox.sentAt ? new Date(outbox.sentAt) : undefined,
	attachments,
});

export const toNodemailerOptions = (message: MailMessage): SendMailOptions => ({
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
	date: message.date,
	attachments: message.attachments?.map((a) => ({
		filename: a.filename,
		content: a.content,
		contentType: a.contentType,
		cid: a.cid,
		contentDisposition: a.contentDisposition,
	})),
});

/** Serialize a message to RFC822 bytes, for an IMAP APPEND. */
export const renderRawMessage = async (
	message: MailMessage,
): Promise<Buffer> => {
	const transport = nodemailer.createTransport({ streamTransport: true });
	const info = await transport.sendMail(toNodemailerOptions(message));

	const chunks: Buffer[] = [];
	for await (const chunk of info.message as AsyncIterable<Buffer>) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
};
