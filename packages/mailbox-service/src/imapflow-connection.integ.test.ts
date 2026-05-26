/**
 * Integration tests for ImapFlowConnection using mokapi.
 *
 * These tests require mokapi to be running:
 *   npm run start:mokapi
 *
 * Run with:
 *   npm run test:integ -w packages/remit-mailbox-service
 *
 * Note: mokapi has some limitations:
 * - Doesn't return COPYUID responses (uidMap is empty)
 * - Doesn't return ENVELOPE data
 * - Closes connection after APPEND
 * - Requires mailbox close/reopen to see changes
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import { ImapFlowConnection } from "./imapflow-connection.js";

const MOKAPI_CONFIG = {
	host: "localhost",
	port: 143,
	user: "alice@mokapi.io",
	password: "alice123",
	tls: false,
};

/**
 * Helper to create a connection.
 */
const createConnection = (): ImapFlowConnection => {
	return new ImapFlowConnection(MOKAPI_CONFIG);
};

/**
 * Helper to run a test with a managed connection.
 * Creates a connection, runs the test, and ensures cleanup.
 */
const withConnection = async (
	fn: (connection: ImapFlowConnection) => Promise<void>,
): Promise<void> => {
	const connection = createConnection();
	await connection.connect();
	await fn(connection).finally(() => {
		if (connection.isConnected) {
			return connection.disconnect();
		}
	});
};

/**
 * Helper to append a test message to a mailbox and find its UID.
 * Works around mokapi closing connection after APPEND by using
 * a separate connection for seeding.
 *
 * @returns The UID of the appended message
 */
const seedTestMessage = async (
	mailbox: string,
	subject: string,
): Promise<number> => {
	const seedConn = createConnection();
	await seedConn.connect();

	const message = [
		"From: test@example.com",
		"To: alice@mokapi.io",
		`Subject: ${subject}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${Date.now()}-${Math.random()}@test.example.com>`,
		"",
		`Test message body for ${subject}`,
	].join("\r\n");

	// Append the message (connection may close after this in mokapi)
	await seedConn.append(mailbox, message);

	// mokapi closes connection after APPEND, so reconnect to find the UID
	const findConn = createConnection();
	await findConn.connect();
	await findConn.openBox(mailbox, true);
	const uids = await findConn.search(["ALL"]);

	// Find the message by fetching headers (mokapi doesn't support ENVELOPE)
	// biome-ignore lint/suspicious/noExplicitAny: Accessing private client for test purposes
	const client = (findConn as any).client;
	let foundUid: number | undefined;

	for await (const msg of client.fetch(
		uids.slice(-10).join(","),
		{ uid: true, headers: ["subject"] },
		{ uid: true },
	)) {
		const headerText = msg.headers?.toString() || "";
		const subjectMatch = headerText.match(/^subject:\s*(.+)$/im);
		if (subjectMatch && subjectMatch[1].trim() === subject) {
			foundUid = msg.uid;
			break;
		}
	}

	await findConn.disconnect();

	if (!foundUid) {
		throw new Error(`Could not find seeded message with subject: ${subject}`);
	}

	return foundUid;
};

/**
 * Helper to count messages in a mailbox using a fresh connection.
 * This works around mokapi's caching by using a new connection.
 */
const countMessagesInMailbox = async (mailbox: string): Promise<number> => {
	const conn = createConnection();
	await conn.connect();
	await conn.openBox(mailbox, true);
	const uids = await conn.search(["ALL"]);
	await conn.disconnect();
	return uids.length;
};

/**
 * Helper to get all UIDs in a mailbox using a fresh connection.
 */
const getMailboxUids = async (mailbox: string): Promise<number[]> => {
	const conn = createConnection();
	await conn.connect();
	await conn.openBox(mailbox, true);
	const uids = await conn.search(["ALL"]);
	await conn.disconnect();
	return uids;
};

describe(
	"ImapFlowConnection integration tests",
	{
		skip: !process.env.RUN_INTEG_TESTS,
	},
	() => {
		describe("moveMessages", () => {
			test("moves a message to another mailbox", async () => {
				// Seed the test message first
				const subject = `Move test ${Date.now()}`;
				const uid = await seedTestMessage("INBOX", subject);

				// Count messages in Work before
				const workCountBefore = await countMessagesInMailbox("Work");

				await withConnection(async (connection) => {
					// Open INBOX
					await connection.openBox("INBOX", false);

					// Move to Work folder
					const result = await connection.moveMessages([uid], "Work");

					// mokapi doesn't return uidMap, but should return destination
					assert.equal(
						result.destination,
						"Work",
						"Destination should be Work",
					);
				});

				// Verify message moved using fresh connections (mokapi caching workaround)
				const inboxUids = await getMailboxUids("INBOX");
				assert.ok(
					!inboxUids.includes(uid),
					"Original UID should not be in INBOX",
				);

				const workCountAfter = await countMessagesInMailbox("Work");
				assert.ok(
					workCountAfter > workCountBefore,
					`Work folder should have more messages (before: ${workCountBefore}, after: ${workCountAfter})`,
				);
			});

			test("returns empty uidMap when no UIDs provided", async () => {
				await withConnection(async (connection) => {
					await connection.openBox("INBOX", false);

					const result = await connection.moveMessages([], "Work");

					assert.equal(result.destination, "Work");
					assert.equal(result.uidMap.size, 0);
				});
			});
		});

		describe("copyMessages", () => {
			test("copies a message to another mailbox", async () => {
				// Seed the test message first
				const subject = `Copy test ${Date.now()}`;
				const uid = await seedTestMessage("INBOX", subject);

				// Count messages in Archive before
				const archiveCountBefore = await countMessagesInMailbox("Archive");

				await withConnection(async (connection) => {
					// Open INBOX
					await connection.openBox("INBOX", false);

					// Copy to Archive folder
					const result = await connection.copyMessages([uid], "Archive");

					assert.equal(
						result.destination,
						"Archive",
						"Destination should be Archive",
					);
				});

				// Verify original message is still in INBOX
				const inboxUids = await getMailboxUids("INBOX");
				assert.ok(
					inboxUids.includes(uid),
					"Original UID should still be in INBOX",
				);

				// Verify copy is in Archive (count increased)
				const archiveCountAfter = await countMessagesInMailbox("Archive");
				assert.ok(
					archiveCountAfter > archiveCountBefore,
					`Archive folder should have more messages (before: ${archiveCountBefore}, after: ${archiveCountAfter})`,
				);

				// Cleanup: delete the original from INBOX
				await withConnection(async (connection) => {
					await connection.openBox("INBOX", false);
					await connection.deleteMessages([uid]);
				});
			});

			test("returns empty uidMap when no UIDs provided", async () => {
				await withConnection(async (connection) => {
					await connection.openBox("INBOX", false);

					const result = await connection.copyMessages([], "Archive");

					assert.equal(result.destination, "Archive");
					assert.equal(result.uidMap.size, 0);
				});
			});
		});

		describe("deleteMessages", () => {
			test("permanently deletes a message", async () => {
				// Seed the test message first
				const subject = `Delete test ${Date.now()}`;
				const uid = await seedTestMessage("INBOX", subject);

				// Verify message exists
				let uids = await getMailboxUids("INBOX");
				assert.ok(uids.includes(uid), "Message should exist before delete");

				await withConnection(async (connection) => {
					// Open INBOX
					await connection.openBox("INBOX", false);

					// Delete the message
					const deleted = await connection.deleteMessages([uid]);
					// mokapi may return true instead of count
					assert.ok(deleted, "Should report message deleted");

					// mokapi requires mailbox close for delete to persist
					await connection.closeBox();

					// Verify within same connection
					await connection.openBox("INBOX", true);
					uids = await connection.search(["ALL"]);
					assert.ok(
						!uids.includes(uid),
						"Message should not exist after delete",
					);
				});
			});

			test("returns 0 when no UIDs provided", async () => {
				await withConnection(async (connection) => {
					await connection.openBox("INBOX", false);

					const deleted = await connection.deleteMessages([]);
					assert.equal(deleted, 0);
				});
			});
		});

		describe("move to Trash workflow", () => {
			test("moves message to Trash folder", async () => {
				// Seed the test message first
				const subject = `Trash test ${Date.now()}`;
				const uid = await seedTestMessage("INBOX", subject);

				// Count messages in Trash before
				const trashCountBefore = await countMessagesInMailbox("Trash");

				await withConnection(async (connection) => {
					// Open INBOX
					await connection.openBox("INBOX", false);

					// Move to Trash
					const result = await connection.moveMessages([uid], "Trash");

					assert.equal(
						result.destination,
						"Trash",
						"Destination should be Trash",
					);
				});

				// Verify message is no longer in INBOX
				const inboxUids = await getMailboxUids("INBOX");
				assert.ok(!inboxUids.includes(uid), "Message should not be in INBOX");

				// Verify message is in Trash (count increased)
				const trashCountAfter = await countMessagesInMailbox("Trash");
				assert.ok(
					trashCountAfter > trashCountBefore,
					`Trash folder should have more messages (before: ${trashCountBefore}, after: ${trashCountAfter})`,
				);
			});
		});
	},
);
