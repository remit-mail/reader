import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as entities from "@remit/drizzle-sqlite-schema";
import Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "./db.js";
import { sweepOrphanedMail } from "./repair/orphaned-mail.js";
import { MESSAGE_REMOVED_EVENT } from "./repos/message.js";
import { outboxTable } from "./schema/outbox.js";
import {
	applyMigration,
	migrationJournal,
} from "./test-shipped-sqlite-schema.js";

const DEDUPE = "0029_mailbox_path_dedupe";
const UNIQUE = "0030_mailbox_path_unique";
const ACCOUNT = "acct";
const CONFIG = "cfg";

type Handle = { sqlite: Database.Database; db: Db<Record<string, unknown>> };

const atPredecessor = (): Handle => {
	const sqlite = new Database(":memory:");
	for (const entry of migrationJournal()) {
		if (entry.tag === DEDUPE) {
			return {
				sqlite,
				db: drizzle(sqlite) as unknown as Db<Record<string, unknown>>,
			};
		}
		applyMigration(sqlite, entry.tag);
	}
	throw new Error(`${DEDUPE} is not in the journal`);
};

const seedMailbox = async (
	{ db }: Handle,
	mailboxId: string,
	fullPath: string,
	createdAt: number,
	messageCount = 0,
): Promise<void> => {
	await db.insert(entities.mailboxes).values({
		mailboxId,
		accountId: ACCOUNT,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 1,
		uidNext: 1,
		highestModseq: "0",
		messageCount,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		createdAt,
		updatedAt: createdAt,
	});
};

const seedMessage = async (
	{ db }: Handle,
	messageId: string,
	mailboxId: string,
): Promise<void> => {
	await db.insert(entities.messages).values({
		messageId,
		mailboxId,
		uid: 1,
		sequenceNumber: 1,
		rfc822Size: 1,
		internalDate: 0,
		envelopeId: `env-${messageId}`,
		rootBodyPartId: `bp-${messageId}`,
		createdAt: 0,
		updatedAt: 0,
	});
	await db.insert(entities.threadMessages).values({
		threadMessageId: `tm-${messageId}`,
		threadId: `thread-${messageId}`,
		messageId,
		accountConfigId: CONFIG,
		mailboxId,
		uid: 1,
		referenceOrder: 0,
		internalDate: 0,
		sentDate: 0,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		createdAt: 0,
		updatedAt: 0,
	});
};

const dedupe = (handle: Handle): void => {
	applyMigration(handle.sqlite, DEDUPE);
	applyMigration(handle.sqlite, UNIQUE);
};

const mailboxIds = async ({ db }: Handle): Promise<string[]> =>
	(
		await db
			.select({ mailboxId: entities.mailboxes.mailboxId })
			.from(entities.mailboxes)
			.orderBy(asc(entities.mailboxes.mailboxId))
	).map((row) => row.mailboxId);

describe("(account_id, full_path) becomes unique", () => {
	test("the row holding the mail survives, and what named the loser follows it", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "older-empty", "INBOX/Notifications", 1);
		await seedMailbox(handle, "with-mail", "INBOX/Notifications", 2);
		await seedMailbox(handle, "child", "INBOX/Notifications/Old", 3);
		await seedMessage(handle, "m1", "with-mail");
		await handle.db
			.update(entities.mailboxes)
			.set({ parentMailboxId: "older-empty" })
			.where(eq(entities.mailboxes.mailboxId, "child"));
		await handle.db.insert(entities.filters).values({
			filterId: "f1",
			accountConfigId: CONFIG,
			name: "Alerts",
			scope: "Standing",
			ruleChangedAt: 0,
			actionChangedAt: 0,
			actionMailboxId: "older-empty",
			createdAt: 0,
			updatedAt: 0,
		});
		await handle.db.insert(entities.accountSettings).values({
			accountSettingId: "s1",
			accountConfigId: CONFIG,
			name: "folderRole",
			value: { kind: "String", value: "older-empty" },
			createdAt: 0,
			updatedAt: 0,
		});
		await handle.db.insert(entities.mailboxFlags).values({
			mailboxFlagId: "flag-1",
			mailboxId: "older-empty",
			flagName: "\\Seen",
			isPermanent: true,
		});

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["child", "with-mail"]);
		const [child] = await handle.db
			.select({ parent: entities.mailboxes.parentMailboxId })
			.from(entities.mailboxes)
			.where(eq(entities.mailboxes.mailboxId, "child"));
		assert.equal(child?.parent, "with-mail");
		const [filter] = await handle.db.select().from(entities.filters);
		assert.equal(filter?.actionMailboxId, "with-mail");
		const [setting] = await handle.db.select().from(entities.accountSettings);
		assert.deepEqual(setting?.value, { kind: "String", value: "with-mail" });
		assert.deepEqual(await handle.db.select().from(entities.mailboxFlags), []);
		const indexes = (
			handle.sqlite.prepare("PRAGMA index_list(mailbox)").all() as Array<{
				name: string;
				unique: number;
			}>
		).find((index) => index.name === "mailbox_by_account_full_path");
		assert.equal(indexes?.unique, 1);
		handle.sqlite.close();
	});

	test("the survivor is chosen by the mail it holds, not by message_count", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "claims-mail", "Archive", 1, 500);
		await seedMailbox(handle, "holds-mail", "Archive", 2, 0);
		await seedMessage(handle, "m1", "holds-mail");
		await seedMessage(handle, "m2", "holds-mail");

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["holds-mail"]);
		handle.sqlite.close();
	});

	test("with equal mail the oldest row survives, and the loser's mail is removed with its search entries", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "newer", "Archive", 2);
		await seedMailbox(handle, "older", "Archive", 1);
		await seedMessage(handle, "kept", "older");
		await seedMessage(handle, "stale", "newer");

		dedupe(handle);
		assert.deepEqual(await mailboxIds(handle), ["older"]);

		const report = await sweepOrphanedMail(handle.db, "repair");

		assert.deepEqual(report, { mode: "repair", orphaned: 1, removed: 1 });
		const messages = await handle.db
			.select({ messageId: entities.messages.messageId })
			.from(entities.messages);
		assert.deepEqual(messages, [{ messageId: "kept" }]);
		const threads = await handle.db
			.select({ messageId: entities.threadMessages.messageId })
			.from(entities.threadMessages);
		assert.deepEqual(threads, [{ messageId: "kept" }]);
		const events = await handle.db
			.select({ messageId: outboxTable.messageId, event: outboxTable.event })
			.from(outboxTable);
		assert.deepEqual(events, [
			{ messageId: "stale", event: MESSAGE_REMOVED_EVENT },
		]);
		assert.deepEqual(await sweepOrphanedMail(handle.db, "repair"), {
			mode: "repair",
			orphaned: 0,
			removed: 0,
		});
		handle.sqlite.close();
	});

	test("the unique index is refused without the dedupe ahead of it", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "a", "Archive", 1);
		await seedMailbox(handle, "b", "Archive", 2);

		assert.throws(
			() => applyMigration(handle.sqlite, UNIQUE),
			/UNIQUE constraint failed/,
		);
		handle.sqlite.close();
	});
});
