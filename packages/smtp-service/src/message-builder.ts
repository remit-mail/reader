import type { OutboxMessageItem } from "@remit/remit-electrodb-service";

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
	attachments?: MailAttachment[];
}

export interface MailAttachment {
	filename: string;
	content: Buffer;
	contentType: string;
	cid?: string;
	contentDisposition?: "attachment" | "inline";
}

/**
 * Build Nodemailer message options from OutboxMessage entity
 */
export const buildMailMessage = (
	outbox: OutboxMessageItem,
	attachments?: MailAttachment[],
): MailMessage => {
	const from = outbox.fromName
		? `"${outbox.fromName}" <${outbox.fromAddress}>`
		: outbox.fromAddress;

	return {
		from,
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
		attachments,
	};
};
