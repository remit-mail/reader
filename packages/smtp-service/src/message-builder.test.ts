import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutboxMessageItem } from "@remit/data-ports";
import {
	buildMailMessage,
	type MailAttachment,
	renderRawMessage,
} from "./message-builder.js";

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
	it("stamps the Sent copy with the moment the send was recorded", () => {
		const message = buildMailMessage(baseOutbox({ sentAt: 1_700_000_000_000 }));
		assert.deepEqual(message.date, new Date(1_700_000_000_000));
	});

	it("leaves the date to the transport while the message is still going out", () => {
		const message = buildMailMessage(baseOutbox({ sentAt: undefined }));
		assert.equal(message.date, undefined);
	});

	it("formats From as a quoted display name when fromName is set", () => {
		const message = buildMailMessage(
			baseOutbox({
				fromName: "Alice Sender",
				fromAddress: "alice@example.com",
			}),
		);
		assert.equal(message.from, '"Alice Sender" <alice@example.com>');
	});

	it("escapes a display name that carries a quote", () => {
		const message = buildMailMessage(
			baseOutbox({
				fromName: 'Al "Big" Sender',
				fromAddress: "alice@example.com",
			}),
		);
		assert.equal(message.from, '"Al \\"Big\\" Sender" <alice@example.com>');
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

/**
 * `send-mime.spec.ts` compares both copies off a real server, which covers every
 * shape the API can currently produce. What it cannot reach is what the compose
 * path never sets — a display name, an attachment — so those are asserted here.
 */
describe("renderRawMessage", () => {
	const headerOf = (raw: string, name: string): string | undefined => {
		const head = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, " ");
		return head
			.split(/\r?\n/)
			.find((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))
			?.slice(name.length + 1)
			.trim();
	};

	it("carries the display name into the rendered From", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(
					baseOutbox({
						fromName: "Alice Sender",
						fromAddress: "alice@example.com",
					}),
				),
			),
		);
		assert.equal(headerOf(raw, "From"), "Alice Sender <alice@example.com>");
	});

	it("keeps a display name with a comma from splitting into two addresses", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(
					baseOutbox({ fromName: "Doe, John", fromAddress: "j@example.com" }),
				),
			),
		);
		assert.equal(headerOf(raw, "From"), '"Doe, John" <j@example.com>');
	});

	it("keeps the quotes inside a display name", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(
					baseOutbox({
						fromName: 'Al "Big" Sender',
						fromAddress: "a@example.com",
					}),
				),
			),
		);
		assert.equal(
			headerOf(raw, "From"),
			'"Al \\"Big\\" Sender" <a@example.com>',
		);
	});

	it("renders text and HTML bodies as a multipart/alternative", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(
					baseOutbox({ textBody: "plain text", htmlBody: "<p>html</p>" }),
				),
			),
		);
		assert.match(
			headerOf(raw, "Content-Type") ?? "",
			/^multipart\/alternative/,
		);
		assert.match(raw, /Content-Type: text\/plain/);
		assert.match(raw, /Content-Type: text\/html/);
	});

	it("renders a text-only body without an HTML alternative", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(
					baseOutbox({ textBody: "plain text", htmlBody: undefined }),
				),
			),
		);
		assert.match(headerOf(raw, "Content-Type") ?? "", /^text\/plain/);
		assert.ok(!raw.includes("text/html"));
	});

	it("renders each attachment as its own part", async () => {
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
		const raw = String(
			await renderRawMessage(
				buildMailMessage(baseOutbox({ textBody: "body" }), attachments),
			),
		);

		assert.match(headerOf(raw, "Content-Type") ?? "", /^multipart\/mixed/);
		assert.match(raw, /Content-Type: application\/pdf; name=invoice\.pdf/);
		assert.match(raw, /Content-Disposition: attachment; filename=invoice\.pdf/);
		assert.match(raw, /Content-Type: image\/png; name=logo\.png/);
		assert.match(raw, /Content-Disposition: inline; filename=logo\.png/);
		assert.match(raw, /Content-ID: <logo-cid>/);
		assert.ok(raw.includes(Buffer.from("pdf-bytes").toString("base64")));
		assert.ok(raw.includes(Buffer.from("png-bytes").toString("base64")));
	});

	it("dates the rendered copy from the moment the send was recorded", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(baseOutbox({ sentAt: 1_700_000_000_000 })),
			),
		);
		assert.equal(
			new Date(headerOf(raw, "Date") ?? "").getTime(),
			1_700_000_000_000,
		);
	});

	it("carries addressing and identity headers through unchanged", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(
					baseOutbox({
						toAddresses: ["a@example.com", "b@example.com"],
						ccAddresses: ["c@example.com"],
						replyToAddress: "reply@example.com",
						subject: "Quarterly numbers",
						messageIdValue: "abc.123@example.com",
						inReplyTo: "parent@example.com",
						references: ["one@example.com", "two@example.com"],
					}),
				),
			),
		);

		assert.equal(headerOf(raw, "To"), "a@example.com, b@example.com");
		assert.equal(headerOf(raw, "Cc"), "c@example.com");
		assert.equal(headerOf(raw, "Reply-To"), "reply@example.com");
		assert.equal(headerOf(raw, "Subject"), "Quarterly numbers");
		assert.equal(headerOf(raw, "Message-ID"), "<abc.123@example.com>");
		assert.equal(headerOf(raw, "In-Reply-To"), "<parent@example.com>");
		assert.equal(
			headerOf(raw, "References"),
			"<one@example.com> <two@example.com>",
		);
	});

	// Only the sender ever reads this render, so the header stays. An SMTP
	// transport strips it from the copy that goes to a recipient.
	it("keeps Bcc on the copy filed in Sent", async () => {
		const raw = String(
			await renderRawMessage(
				buildMailMessage(baseOutbox({ bccAddresses: ["hidden@example.com"] })),
			),
		);
		assert.equal(headerOf(raw, "Bcc"), "hidden@example.com");
	});
});
