import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { MailboxCursorState } from "@remit/domain-enums";
import Database from "better-sqlite3";
import { messageDataSchema } from "../schema/message-data.js";
import {
	accountTable,
	envelopeTable,
	mailboxTable,
	messageTable,
} from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import {
	type CascadeEntity,
	createSqliteCascadeDeleter,
} from "./cascade-delete.js";

// createSqliteCascadeDeleter opens the shared SQLite file itself, so the schema
// this harness pushes must live on a real file (not the in-memory default) for
// the deleter's own connection to see it. `deleteMessageSubtree` touches every
// message-data child table, so push the full message-data schema plus the
// account and mailbox containers.
const CASCADE_SCHEMA = {
	...messageDataSchema,
	account: accountTable,
	mailbox: mailboxTable,
};

const log = { info: () => {} };
const NOW = 1700000000000;
const ACCOUNT_CONFIG_ID = "cfg-sqlite-1";
const ACCOUNT_ID = "acc-sqlite-1";
const MAILBOX_ID = "mbx-sqlite-1";
const MESSAGE_ID = "msg-sqlite-1";
const ENVELOPE_ID = "00000000-0000-4000-8000-0000000000a1";
const ROOT_BODY_PART_ID = "00000000-0000-4000-8000-0000000000a2";

describe("createSqliteCascadeDeleter", () => {
	let filename: string;
	let close: () => Promise<void>;

	before(async () => {
		const dir = await mkdtemp(join(tmpdir(), "remit-sqlite-cascade-"));
		filename = join(dir, "cascade.db");
		const created = await createSqliteTestDb(CASCADE_SCHEMA, { filename });
		close = created.close;
		const { db } = created;

		await db.insert(accountTable).values({
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			username: "u",
			email: "u@example.com",
			authType: "password",
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			smtpPort: 587,
			isActive: true,
			connectionState: "authenticated",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(mailboxTable).values({
			mailboxId: MAILBOX_ID,
			accountId: ACCOUNT_ID,
			namespaceType: "personal",
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: "INBOX",
			uidValidity: 1,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: NOW,
			cursorState: MailboxCursorState.normal,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(messageTable).values({
			messageId: MESSAGE_ID,
			mailboxId: MAILBOX_ID,
			uid: 1,
			sequenceNumber: 1,
			rfc822Size: 10,
			internalDate: NOW,
			envelopeId: ENVELOPE_ID,
			rootBodyPartId: ROOT_BODY_PART_ID,
			status: "active",
			syncStatus: "synced",
			category: "uncategorized",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(envelopeTable).values({
			envelopeId: ENVELOPE_ID,
			messageId: MESSAGE_ID,
			dateValue: NOW,
			dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
			createdAt: NOW,
			updatedAt: NOW,
		});

		// Close the seeding connection so the deleter's own WAL connection owns
		// the file without a cross-connection lock.
		await close();
	});

	after(async () => {
		// The seeding connection is already closed; nothing else to release.
	});

	test("deletes the message subtree, mailbox, and account over SQLite, emitting a removal event", async () => {
		const entities: CascadeEntity[] = [
			{ entityType: "Message", key: { messageId: MESSAGE_ID } },
			{ entityType: "Envelope", key: { envelopeId: ENVELOPE_ID } },
			{ entityType: "Mailbox", key: { mailboxId: MAILBOX_ID } },
			{ entityType: "Account", key: { accountId: ACCOUNT_ID } },
		];

		const deleter = await createSqliteCascadeDeleter(filename);
		await deleter(entities, log);

		const sqlite = new Database(filename);
		const count = (table: string, column: string, value: string): number =>
			(
				sqlite
					.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
					.get(value) as { n: number }
			).n;

		assert.equal(count("message", "message_id", MESSAGE_ID), 0, "message gone");
		assert.equal(
			count("envelope", "message_id", MESSAGE_ID),
			0,
			"envelope gone",
		);
		assert.equal(count("mailbox", "mailbox_id", MAILBOX_ID), 0, "mailbox gone");
		assert.equal(count("account", "account_id", ACCOUNT_ID), 0, "account gone");

		const outboxRows = (
			sqlite.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }
		).n;
		assert.ok(
			outboxRows >= 1,
			"a message-removed outbox row must be emitted for search-index cleanup",
		);
		sqlite.close();
	});
});
