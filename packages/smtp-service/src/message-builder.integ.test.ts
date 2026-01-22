/**
 * Integration tests for message builder using mokapi.
 *
 * Tests that messages built from OutboxMessage entities can be sent
 * successfully via SMTP.
 *
 * These tests require mokapi to be running:
 *   npm run start:mokapi
 *
 * Run with:
 *   npm run test:integ -w packages/remit-smtp-service
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import type { OutboxMessageItem } from "@remit/remit-electrodb-service";
import { OutboxMessageStatus } from "@remit/domain-enums";
import { buildMailMessage } from "./message-builder.js";
import { generateMessageId } from "./message-id.js";
import { type SmtpConfig, sendMail } from "./smtp-client.js";

const MOKAPI_SMTP_CONFIG: SmtpConfig = {
	host: "localhost",
	port: 2525,
	secure: false,
	auth: {
		user: "alice@mokapi.io",
		pass: "alice123",
	},
	tls: {
		rejectUnauthorized: false, // Accept mokapi's self-signed cert
	},
};

/**
 * Create a mock OutboxMessageItem for testing.
 * Simulates what would be retrieved from DynamoDB.
 */
const createMockOutboxMessage = (
	overrides: Partial<OutboxMessageItem> = {},
): OutboxMessageItem => {
	const now = Date.now();
	return {
		outboxMessageId: `test-outbox-${now}`,
		accountId: "test-account-id",
		accountConfigId: "test-account-config-id",
		fromAddress: "alice@mokapi.io",
		toAddresses: ["bob@mokapi.io"],
		messageIdValue: generateMessageId("mokapi.io"),
		status: OutboxMessageStatus.queued,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
};

describe(
	"Message builder integration tests",
	{ skip: !process.env.RUN_INTEG_TESTS },
	() => {
		describe("buildMailMessage + sendMail", () => {
			test("builds and sends a simple text message", async () => {
				const outbox = createMockOutboxMessage({
					subject: `Builder test - text ${Date.now()}`,
					textBody: "This is a plain text message built from OutboxMessage.",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");

				// Verify message structure
				assert.equal(message.from, "alice@mokapi.io");
				assert.deepEqual(message.to, ["bob@mokapi.io"]);
				assert.equal(message.messageId, `<${outbox.messageIdValue}>`);
			});

			test("builds and sends an HTML message", async () => {
				const outbox = createMockOutboxMessage({
					subject: `Builder test - HTML ${Date.now()}`,
					textBody: "Plain text fallback",
					htmlBody:
						"<html><body><h1>Test</h1><p>HTML content from OutboxMessage.</p></body></html>",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(message.text, outbox.textBody);
				assert.equal(message.html, outbox.htmlBody);
			});

			test("builds message with fromName formatted correctly", async () => {
				const outbox = createMockOutboxMessage({
					fromName: "Alice Sender",
					fromAddress: "alice@mokapi.io",
					subject: `Builder test - from name ${Date.now()}`,
					textBody: "Message with sender name",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(
					message.from,
					'"Alice Sender" <alice@mokapi.io>',
					"From should be formatted with name",
				);
			});

			test("builds message with multiple recipients", async () => {
				const outbox = createMockOutboxMessage({
					toAddresses: ["bob@mokapi.io", "alice@mokapi.io"],
					subject: `Builder test - multiple to ${Date.now()}`,
					textBody: "Message to multiple recipients",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.deepEqual(message.to, ["bob@mokapi.io", "alice@mokapi.io"]);
			});

			test("builds message with CC addresses", async () => {
				const outbox = createMockOutboxMessage({
					toAddresses: ["bob@mokapi.io"],
					ccAddresses: ["alice@mokapi.io"],
					subject: `Builder test - CC ${Date.now()}`,
					textBody: "Message with CC",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.deepEqual(message.cc, ["alice@mokapi.io"]);
			});

			test("builds message with BCC addresses", async () => {
				const outbox = createMockOutboxMessage({
					toAddresses: ["bob@mokapi.io"],
					bccAddresses: ["alice@mokapi.io"],
					subject: `Builder test - BCC ${Date.now()}`,
					textBody: "Message with BCC",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.deepEqual(message.bcc, ["alice@mokapi.io"]);
			});

			test("builds message with replyTo address", async () => {
				const outbox = createMockOutboxMessage({
					replyToAddress: "support@mokapi.io",
					subject: `Builder test - replyTo ${Date.now()}`,
					textBody: "Message with reply-to",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(message.replyTo, "support@mokapi.io");
			});

			test("builds reply message with inReplyTo header", async () => {
				const originalMsgId = "original-message-123@example.com";
				const outbox = createMockOutboxMessage({
					inReplyTo: originalMsgId,
					subject: `Re: Original subject ${Date.now()}`,
					textBody: "This is a reply message.",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(
					message.inReplyTo,
					`<${originalMsgId}>`,
					"In-Reply-To should be wrapped in angle brackets",
				);
			});

			test("builds reply message with references header", async () => {
				const references = [
					"msg-1@example.com",
					"msg-2@example.com",
					"msg-3@example.com",
				];
				const outbox = createMockOutboxMessage({
					inReplyTo: "msg-3@example.com",
					references,
					subject: `Re: Thread ${Date.now()}`,
					textBody: "Reply in a thread.",
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(
					message.references,
					"<msg-1@example.com> <msg-2@example.com> <msg-3@example.com>",
					"References should be space-separated with angle brackets",
				);
			});

			test("generates correct Message-ID format", async () => {
				const messageIdValue = generateMessageId("mokapi.io");
				const outbox = createMockOutboxMessage({
					messageIdValue,
					subject: `Builder test - Message-ID ${Date.now()}`,
					textBody: "Testing Message-ID format",
				});

				const message = buildMailMessage(outbox);

				// Message-ID should be wrapped in angle brackets
				assert.ok(
					message.messageId.startsWith("<"),
					"Message-ID should start with <",
				);
				assert.ok(
					message.messageId.endsWith(">"),
					"Message-ID should end with >",
				);
				assert.equal(
					message.messageId,
					`<${messageIdValue}>`,
					"Message-ID should wrap the raw value",
				);

				// Verify it can be sent
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);
				assert.equal(result.success, true, "Send should succeed");
			});

			test("handles message without optional fields", async () => {
				const outbox = createMockOutboxMessage({
					subject: undefined,
					textBody: undefined,
					htmlBody: undefined,
					ccAddresses: undefined,
					bccAddresses: undefined,
					replyToAddress: undefined,
					inReplyTo: undefined,
					references: undefined,
				});

				const message = buildMailMessage(outbox);
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(message.subject, undefined);
				assert.equal(message.text, undefined);
				assert.equal(message.html, undefined);
				assert.equal(message.cc, undefined);
				assert.equal(message.bcc, undefined);
				assert.equal(message.replyTo, undefined);
				assert.equal(message.inReplyTo, undefined);
				assert.equal(message.references, undefined);
			});

			test("builds complete message with all fields", async () => {
				const outbox = createMockOutboxMessage({
					fromName: "Alice Complete",
					fromAddress: "alice@mokapi.io",
					toAddresses: ["bob@mokapi.io"],
					ccAddresses: ["cc-user@mokapi.io"],
					bccAddresses: ["bcc-user@mokapi.io"],
					replyToAddress: "reply@mokapi.io",
					subject: `Complete message test ${Date.now()}`,
					textBody: "Plain text version",
					htmlBody: "<p>HTML version</p>",
					inReplyTo: "original@example.com",
					references: ["ref1@example.com", "ref2@example.com"],
				});

				const message = buildMailMessage(outbox);

				// Verify all fields are mapped correctly
				assert.equal(message.from, '"Alice Complete" <alice@mokapi.io>');
				assert.deepEqual(message.to, ["bob@mokapi.io"]);
				assert.deepEqual(message.cc, ["cc-user@mokapi.io"]);
				assert.deepEqual(message.bcc, ["bcc-user@mokapi.io"]);
				assert.equal(message.replyTo, "reply@mokapi.io");
				assert.equal(message.subject, outbox.subject);
				assert.equal(message.text, "Plain text version");
				assert.equal(message.html, "<p>HTML version</p>");
				assert.equal(message.inReplyTo, "<original@example.com>");
				assert.equal(
					message.references,
					"<ref1@example.com> <ref2@example.com>",
				);

				// Verify it can be sent
				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);
				assert.equal(result.success, true, "Send should succeed");
			});
		});
	},
);
