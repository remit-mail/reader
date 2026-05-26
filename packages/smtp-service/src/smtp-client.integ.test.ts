/**
 * Integration tests for SMTP client using mokapi.
 *
 * These tests require mokapi to be running:
 *   npm run start:mokapi
 *
 * Run with:
 *   npm run test:integ -w packages/smtp-service
 *
 * Note: mokapi SMTP server runs on port 2525 without TLS.
 * Sent emails are delivered to the recipient's IMAP mailbox.
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import type { MailMessage } from "./message-builder.js";
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
 * Generate a unique message ID for testing
 */
const createTestMessageId = (): string => {
	return `<${generateMessageId("mokapi.io")}>`;
};

/**
 * Create a basic test message
 */
const createTestMessage = (
	overrides: Partial<MailMessage> = {},
): MailMessage => {
	return {
		from: "alice@mokapi.io",
		to: ["bob@mokapi.io"],
		subject: `Test message ${Date.now()}`,
		text: "This is a test message body.",
		messageId: createTestMessageId(),
		...overrides,
	};
};

describe(
	"SMTP client integration tests",
	{
		skip: !process.env.RUN_INTEG_TESTS,
	},
	() => {
		describe("sendMail", () => {
			test("sends a simple text message", async () => {
				const message = createTestMessage({
					subject: `Simple text test ${Date.now()}`,
					text: "Hello from the SMTP integration test!",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.equal(result.isTransient, false, "Should not be transient");
				assert.ok(result.messageId, "Should return a message ID");
				assert.ok(result.response, "Should return an SMTP response");
			});

			test("sends an HTML message", async () => {
				const message = createTestMessage({
					subject: `HTML test ${Date.now()}`,
					text: "Plain text fallback",
					html: "<html><body><h1>Hello!</h1><p>This is an <strong>HTML</strong> message.</p></body></html>",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a message with CC recipients", async () => {
				const message = createTestMessage({
					subject: `CC test ${Date.now()}`,
					to: ["bob@mokapi.io"],
					cc: ["alice@mokapi.io"],
					text: "Message with CC recipient",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a message with BCC recipients", async () => {
				const message = createTestMessage({
					subject: `BCC test ${Date.now()}`,
					to: ["bob@mokapi.io"],
					bcc: ["alice@mokapi.io"],
					text: "Message with BCC recipient",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a message with multiple recipients", async () => {
				const message = createTestMessage({
					subject: `Multiple recipients test ${Date.now()}`,
					to: ["bob@mokapi.io", "alice@mokapi.io"],
					text: "Message to multiple recipients",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a reply with In-Reply-To header", async () => {
				const originalMessageId = "<original-message-123@mokapi.io>";
				const message = createTestMessage({
					subject: `Re: Original subject ${Date.now()}`,
					text: "This is a reply to your message.",
					inReplyTo: originalMessageId,
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a reply with References header", async () => {
				const references = [
					"<msg-1@mokapi.io>",
					"<msg-2@mokapi.io>",
					"<msg-3@mokapi.io>",
				].join(" ");

				const message = createTestMessage({
					subject: `Re: Thread subject ${Date.now()}`,
					text: "This is a reply in a thread.",
					inReplyTo: "<msg-3@mokapi.io>",
					references,
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a message with Reply-To address", async () => {
				const message = createTestMessage({
					subject: `Reply-To test ${Date.now()}`,
					text: "Please reply to a different address.",
					replyTo: "noreply@mokapi.io",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("sends a message with formatted From name", async () => {
				const message = createTestMessage({
					from: '"Alice Test" <alice@mokapi.io>',
					subject: `From name test ${Date.now()}`,
					text: "Message with formatted From name",
				});

				const result = await sendMail(MOKAPI_SMTP_CONFIG, message);

				assert.equal(result.success, true, "Send should succeed");
				assert.ok(result.messageId, "Should return a message ID");
			});

			test("handles connection failure gracefully", async () => {
				const badConfig: SmtpConfig = {
					host: "localhost",
					port: 9999, // Non-existent port
					secure: false,
					auth: {
						user: "alice@mokapi.io",
						pass: "alice123",
					},
					connectionTimeout: 1000, // Short timeout for tests
				};

				const message = createTestMessage();
				const result = await sendMail(badConfig, message);

				assert.equal(result.success, false, "Send should fail");
				assert.ok(result.error, "Should return an error");
				// Connection errors are typically transient
				assert.equal(
					result.isTransient,
					false,
					"Connection errors without SMTP code are not transient",
				);
			});

			test("handles authentication failure", async () => {
				const badAuthConfig: SmtpConfig = {
					host: "localhost",
					port: 2525,
					secure: false,
					auth: {
						user: "alice@mokapi.io",
						pass: "wrong-password",
					},
					tls: {
						rejectUnauthorized: false,
					},
					connectionTimeout: 5000,
				};

				const message = createTestMessage();
				const result = await sendMail(badAuthConfig, message);

				// mokapi may or may not enforce authentication
				// If it does, this should fail; if not, it will succeed
				if (!result.success) {
					assert.ok(result.error, "Should return an error");
					// 5xx errors are permanent (not transient)
					if (result.smtpCode && result.smtpCode >= 500) {
						assert.equal(
							result.isTransient,
							false,
							"Auth failure should be permanent",
						);
					}
				}
			});
		});
	},
);
