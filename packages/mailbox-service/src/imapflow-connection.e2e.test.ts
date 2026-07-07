import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import {
	seedMailbox,
	uniqueMailboxName,
} from "./test-helpers/isolated-mailbox.js";
import {
	createMailfuzzConnection,
	withMailfuzzConnection,
} from "./test-helpers/mailfuzz-connection.js";

describe(
	"Mailbox listing (Dovecot)",
	{
		skip: !process.env.RUN_E2E_TESTS,
	},
	() => {
		test("lists mailboxes and INBOX exists", async () => {
			await withMailfuzzConnection(async (connection) => {
				const mailboxes = await connection.listMailboxes();

				assert.ok(mailboxes.length > 0, "Should have at least one mailbox");

				const inbox = mailboxes.find((m) => m.fullPath === "INBOX");
				assert.ok(inbox, "INBOX should exist in mailbox list");
				assert.equal(inbox.name, "INBOX");
			});
		});

		test("returns mailbox status with uidValidity and uidNext", async () => {
			await withMailfuzzConnection(async (connection) => {
				const status = await connection.getMailboxStatus("INBOX");

				assert.ok(status.uidValidity > 0, "uidValidity should be positive");
				assert.ok(status.uidNext > 0, "uidNext should be positive");
				assert.ok(status.messages > 0, "INBOX should have messages");
			});
		});
	},
);

describe(
	"Message fetch (Dovecot)",
	{
		skip: !process.env.RUN_E2E_TESTS,
	},
	() => {
		test("fetches messages with ENVELOPE data", async () => {
			await withMailfuzzConnection(async (connection) => {
				const boxStatus = await connection.openBox("INBOX", true);
				assert.ok(boxStatus.messages.total > 0, "INBOX should have messages");

				const uids = await connection.search(["ALL"]);
				assert.ok(uids.length > 0, "Should find messages");

				const fetchUids = uids.slice(0, 5);
				const messages = await connection.fetchMessages(fetchUids);

				assert.equal(
					messages.length,
					fetchUids.length,
					"Should fetch all requested messages",
				);

				for (const msg of messages) {
					assert.ok(msg.uid > 0, "Message should have a UID");
					assert.ok(msg.envelope, "Message should have envelope data");
					assert.ok(msg.envelope.subject, "Envelope should have a subject");
					assert.ok(msg.envelope.messageId, "Envelope should have a messageId");
					assert.ok(msg.envelope.date, "Envelope should have a date");
					assert.ok(
						msg.envelope.from.length > 0,
						"Envelope should have from addresses",
					);
					assert.ok(
						msg.envelope.to.length > 0,
						"Envelope should have to addresses",
					);

					for (const addr of msg.envelope.from) {
						assert.ok(addr.mailbox, "From address should have mailbox");
						assert.ok(addr.host, "From address should have host");
					}
				}
			});
		});

		test("fetched message count matches status", async () => {
			// Seed a mailbox this test owns so the SELECT-vs-SEARCH invariant holds
			// regardless of what other e2e files do in parallel — the TOCTOU race
			// that #501 papered over with --test-concurrency=1 is removed by
			// isolation, not serialisation (#508).
			const mailbox = uniqueMailboxName("E2E_count");
			await withMailfuzzConnection(async (connection) => {
				await seedMailbox(connection, mailbox, 3);
				try {
					const boxStatus = await connection.openBox(mailbox, true);
					const uids = await connection.search(["ALL"]);

					assert.equal(
						uids.length,
						boxStatus.messages.total,
						"Search ALL count should match SELECT messages count",
					);
				} finally {
					await connection.closeBox().catch(() => {});
					await connection.deleteMailbox(mailbox).catch(() => {});
				}
			});
		});
	},
);

describe(
	"Message bodies (Dovecot)",
	{
		skip: !process.env.RUN_E2E_TESTS,
	},
	() => {
		test("fetches message body with text content", async () => {
			await withMailfuzzConnection(async (connection) => {
				await connection.openBox("INBOX", true);
				const uids = await connection.search(["ALL"]);
				assert.ok(uids.length > 0, "Should have messages to fetch body for");

				const body = await connection.fetchMessageBody(uids[0]);
				assert.ok(body.length > 0, "Body should not be empty");

				const bodyText = body.toString("utf-8");
				assert.ok(bodyText.length > 0, "Body text should not be empty");
			});
		});
	},
);

describe(
	"Flag operations (Dovecot)",
	{
		skip: !process.env.RUN_E2E_TESTS,
		// These three subtests all mutate uids[0] of the same seeded mailbox, so
		// they must run sequentially relative to each other. node:test already
		// serialises subtests within a describe; concurrency: 1 pins that intent.
		// Cross-file isolation (a dedicated seeded mailbox, not the shared INBOX)
		// is what makes the whole suite safe to run in parallel — see #508.
		concurrency: 1,
	},
	() => {
		let targetUid: number;
		const mailbox = uniqueMailboxName("E2E_flags");

		before(async () => {
			await withMailfuzzConnection(async (connection) => {
				await seedMailbox(connection, mailbox, 3);
			});
		});

		after(async () => {
			const connection = createMailfuzzConnection();
			await connection.connect();
			await connection.deleteMailbox(mailbox).catch(() => {});
			if (connection.isConnected) {
				await connection.disconnect();
			}
		});

		test("sets \\Seen flag and verifies it persists", async () => {
			await withMailfuzzConnection(async (connection) => {
				await connection.openBox(mailbox, false);
				const uids = await connection.search(["ALL"]);
				assert.ok(uids.length > 0, "Should have messages");
				targetUid = uids[0];

				await connection.removeFlags([targetUid], ["\\Seen"]);
				await connection.addFlags([targetUid], ["\\Seen"]);

				const messages = await connection.fetchMessages([targetUid]);
				assert.equal(messages.length, 1);
				assert.ok(
					messages[0].flags.includes("\\Seen"),
					"Message should have \\Seen flag",
				);
			});
		});

		test("clears \\Seen flag and verifies it is cleared", async () => {
			await withMailfuzzConnection(async (connection) => {
				await connection.openBox(mailbox, false);
				const uids = await connection.search(["ALL"]);
				targetUid = uids[0];

				await connection.addFlags([targetUid], ["\\Seen"]);
				await connection.removeFlags([targetUid], ["\\Seen"]);

				const messages = await connection.fetchMessages([targetUid]);
				assert.equal(messages.length, 1);
				assert.ok(
					!messages[0].flags.includes("\\Seen"),
					"Message should not have \\Seen flag after removal",
				);
			});
		});

		test("sets custom keyword flag", async () => {
			await withMailfuzzConnection(async (connection) => {
				await connection.openBox(mailbox, false);
				const uids = await connection.search(["ALL"]);
				targetUid = uids[0];

				await connection.addFlags([targetUid], ["$label1"]);

				const messages = await connection.fetchMessages([targetUid]);
				assert.equal(messages.length, 1);
				assert.ok(
					messages[0].flags.includes("$label1"),
					"Message should have custom keyword $label1",
				);

				await connection.removeFlags([targetUid], ["$label1"]);
			});
		});
	},
);

describe(
	"Message operations (Dovecot)",
	{
		skip: !process.env.RUN_E2E_TESTS,
	},
	() => {
		const testFolder = uniqueMailboxName("E2E_TestCopy");
		// Copy/move source their messages from a mailbox this file owns rather than
		// the shared INBOX, so nothing here appends to or mutates INBOX (#508).
		const sourceFolder = uniqueMailboxName("E2E_TestSource");

		before(async () => {
			await withMailfuzzConnection(async (connection) => {
				await seedMailbox(connection, sourceFolder, 3);
			});
		});

		test("copy returns COPYUID response with uidMap entries", async () => {
			await withMailfuzzConnection(async (connection) => {
				await connection.createMailbox(testFolder);

				await connection.openBox(sourceFolder, false);
				const uids = await connection.search(["ALL"]);
				assert.ok(uids.length > 0, "Should have messages to copy");

				const result = await connection.copyMessages([uids[0]], testFolder);

				assert.equal(result.destination, testFolder);
				assert.ok(
					result.uidMap.size > 0,
					"COPYUID response should have uidMap entries",
				);
				assert.ok(
					result.uidMap.has(uids[0]),
					"uidMap should contain the source UID",
				);
			});
		});

		test("move returns COPYUID response with uidMap entries", async () => {
			const moveFolder = uniqueMailboxName("E2E_TestMove");

			await withMailfuzzConnection(async (connection) => {
				await connection.createMailbox(moveFolder);

				const appendResult = await connection.append(
					sourceFolder,
					[
						"From: test@example.com",
						"To: vmail@localhost",
						"Subject: Move test message",
						`Date: ${new Date().toUTCString()}`,
						`Message-ID: <move-test-${Date.now()}@test.example.com>`,
						"",
						"Body for move test",
					].join("\r\n"),
				);

				await connection.openBox(sourceFolder, false);
				const result = await connection.moveMessages(
					[appendResult.uid],
					moveFolder,
				);

				assert.equal(result.destination, moveFolder);
				assert.ok(
					result.uidMap.size > 0,
					"COPYUID response should have uidMap entries",
				);

				await connection.closeBox();
				await connection.deleteMailbox(moveFolder);
			});
		});

		after(async () => {
			const connection = createMailfuzzConnection();
			await connection.connect();
			await connection.deleteMailbox(testFolder).catch(() => {});
			await connection.deleteMailbox(sourceFolder).catch(() => {});
			if (connection.isConnected) {
				await connection.disconnect();
			}
		});
	},
);

describe("Mailbox CRUD (Dovecot)", { skip: !process.env.RUN_E2E_TESTS }, () => {
	const crudFolder = `CrudTest_${Date.now()}`;
	const renamedFolder = `CrudRenamed_${Date.now()}`;

	test("creates a new mailbox", async () => {
		await withMailfuzzConnection(async (connection) => {
			const result = await connection.createMailbox(crudFolder);
			assert.ok(result.created, "Mailbox should be created");

			const mailboxes = await connection.listMailboxes();
			const found = mailboxes.find((m) => m.fullPath === crudFolder);
			assert.ok(found, `Mailbox ${crudFolder} should exist after creation`);
		});
	});

	test("renames a mailbox", async () => {
		await withMailfuzzConnection(async (connection) => {
			const result = await connection.renameMailbox(crudFolder, renamedFolder);
			assert.ok(result.newPath, "Should return new path");

			const mailboxes = await connection.listMailboxes();
			const oldFound = mailboxes.find((m) => m.fullPath === crudFolder);
			assert.ok(
				!oldFound,
				`Old mailbox ${crudFolder} should not exist after rename`,
			);

			const newFound = mailboxes.find((m) => m.fullPath === renamedFolder);
			assert.ok(newFound, `Renamed mailbox ${renamedFolder} should exist`);
		});
	});

	test("deletes a mailbox", async () => {
		await withMailfuzzConnection(async (connection) => {
			await connection.deleteMailbox(renamedFolder);

			const mailboxes = await connection.listMailboxes();
			const found = mailboxes.find((m) => m.fullPath === renamedFolder);
			assert.ok(
				!found,
				`Mailbox ${renamedFolder} should not exist after deletion`,
			);
		});
	});
});
