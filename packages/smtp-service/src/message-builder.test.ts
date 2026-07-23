import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutboxMessageItem } from "@remit/data-ports";
import { buildMailMessage, type MailAttachment } from "./message-builder.js";

const baseOutbox = (
	overrides: Partial<OutboxMessageItem> = {},
): OutboxMessageItem => ({
	outboxMessageId: "outbox-1",
	accountId: "account-1",
	accountConfigId: "config-1",
	fromAddress: "sender@example.com",
	toAddresses: ["to@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	messageIdValue: "generated-id@example.com",
	references: [],
	status: "queued",
	createdAt: 1_700_000_000_000,
	updatedAt: 1_700_000_000_000,
	...overrides,
});

describe("buildMailMessage", () => {
	it("formats From as a quoted display name when fromName is set", () => {
		const message = buildMailMessage(
			baseOutbox({
				fromName: "Alice Sender",
				fromAddress: "alice@example.com",
			}),
		);
		assert.equal(message.from, '"Alice Sender" <alice@example.com>');
	});

	it("uses the bare address as From when fromName is absent", () => {
		const message = buildMailMessage(
			baseOutbox({ fromName: undefined, fromAddress: "alice@example.com" }),
		);
		assert.equal(message.from, "alice@example.com");
	});

	it("wraps messageIdValue in angle brackets", () => {
		const message = buildMailMessage(
			baseOutbox({ messageIdValue: "abc.123@example.com" }),
		);
		assert.equal(message.messageId, "<abc.123@example.com>");
	});

	it("carries recipient and body fields through unchanged", () => {
		const message = buildMailMessage(
			baseOutbox({
				toAddresses: ["a@example.com", "b@example.com"],
				ccAddresses: ["c@example.com"],
				bccAddresses: ["d@example.com"],
				replyToAddress: "reply@example.com",
				subject: "Hello",
				textBody: "plain text",
				htmlBody: "<p>html</p>",
			}),
		);
		assert.deepEqual(message.to, ["a@example.com", "b@example.com"]);
		assert.deepEqual(message.cc, ["c@example.com"]);
		assert.deepEqual(message.bcc, ["d@example.com"]);
		assert.equal(message.replyTo, "reply@example.com");
		assert.equal(message.subject, "Hello");
		assert.equal(message.text, "plain text");
		assert.equal(message.html, "<p>html</p>");
	});

	it("wraps inReplyTo in angle brackets when present", () => {
		const message = buildMailMessage(
			baseOutbox({ inReplyTo: "parent@example.com" }),
		);
		assert.equal(message.inReplyTo, "<parent@example.com>");
	});

	it("leaves inReplyTo undefined when absent", () => {
		const message = buildMailMessage(baseOutbox({ inReplyTo: undefined }));
		assert.equal(message.inReplyTo, undefined);
	});

	it("angle-brackets each reference and joins them with spaces", () => {
		const message = buildMailMessage(
			baseOutbox({ references: ["one@example.com", "two@example.com"] }),
		);
		assert.equal(message.references, "<one@example.com> <two@example.com>");
	});

	it("produces an empty references string when there are none", () => {
		const message = buildMailMessage(baseOutbox({ references: [] }));
		assert.equal(message.references, "");
	});

	it("passes attachments through to the built message", () => {
		const attachments: MailAttachment[] = [
			{
				filename: "invoice.pdf",
				content: Buffer.from("pdf-bytes"),
				contentType: "application/pdf",
			},
			{
				filename: "logo.png",
				content: Buffer.from("png-bytes"),
				contentType: "image/png",
				cid: "logo-cid",
				contentDisposition: "inline",
			},
		];
		const message = buildMailMessage(baseOutbox(), attachments);
		assert.equal(message.attachments, attachments);
	});

	it("leaves attachments undefined when none are provided", () => {
		const message = buildMailMessage(baseOutbox());
		assert.equal(message.attachments, undefined);
	});
});
