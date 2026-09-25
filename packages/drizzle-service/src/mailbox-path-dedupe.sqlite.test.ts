import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as entities from "@remit/drizzle-sqlite-schema";
import Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "./db.js";
import {
	PARKED_MAILBOX_ID,
	sweepDuplicateMailboxMail,
} from "./repair/duplicate-mailbox-mail.js";
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
	over: Partial<typeof entities.mailboxes.$inferInsert> = {},
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
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		createdAt,
		updatedAt: createdAt,
		...over,
	});
};

const seedMessage = async (
	{ db }: Handle,
	messageId: string,
	mailboxId: string,
	uid = 1,
): Promise<void> => {
	await db.insert(entities.messages).values({
		messageId,
		mailboxId,
		uid,
		sequenceNumber: uid,
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
		uid,
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

const seedSetting = async (
	{ db }: Handle,
	name: string,
	value: typeof entities.accountSettings.$inferInsert.value,
): Promise<void> => {
	await db.insert(entities.accountSettings).values({
		accountSettingId: name,
		accountConfigId: CONFIG,
		name,
		value,
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

const messagesIn = async ({ db }: Handle, mailboxId: string): Promise<number> =>
	(
		await db
			.select({ messageId: entities.messages.messageId })
			.from(entities.messages)
			.where(eq(entities.messages.mailboxId, mailboxId))
	).length;

const threadsIn = async ({ db }: Handle, mailboxId: string): Promise<number> =>
	(
		await db
			.select({ messageId: entities.threadMessages.messageId })
			.from(entities.threadMessages)
			.where(eq(entities.threadMessages.mailboxId, mailboxId))
	).length;

const survivorCursor = async ({ db }: Handle, mailboxId: string) => {
	const [row] = await db
		.select({
			lastSyncUid: entities.mailboxes.lastSyncUid,
			highWaterMarkUid: entities.mailboxes.highWaterMarkUid,
			highestModseq: entities.mailboxes.highestModseq,
		})
		.from(entities.mailboxes)
		.where(eq(entities.mailboxes.mailboxId, mailboxId));
	return row;
};

describe("(account_id, full_path) becomes unique", () => {
	test("the loser's mail moves onto the survivor, so none of it is lost", async () => {
		const handle = atPredecessor();
		const cursor = {
			lastSyncUid: 1,
			highWaterMarkUid: 105,
			highestModseq: "900",
		};
		await seedMailbox(handle, "a", "Archive", 1, cursor);
		await seedMailbox(handle, "b", "Archive", 2, cursor);
		for (let uid = 1; uid <= 100; uid++) {
			await seedMessage(handle, `a-${uid}`, "a", uid);
		}
		for (let uid = 101; uid <= 105; uid++) {
			await seedMessage(handle, `b-${uid}`, "b", uid);
		}

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["a"]);
		assert.equal(await messagesIn(handle, "a"), 105);
		assert.equal(await threadsIn(handle, "a"), 105);
		assert.equal(await messagesIn(handle, PARKED_MAILBOX_ID), 0);
		assert.deepEqual(await survivorCursor(handle, "a"), cursor);
		handle.sqlite.close();
	});

	test("what named the loser follows the survivor", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "older-empty", "INBOX/Notifications", 1);
		await seedMailbox(handle, "with-mail", "INBOX/Notifications", 2);
		await seedMailbox(handle, "child", "INBOX/Notifications/Old", 3);
		await seedMailbox(handle, "elsewhere", "Receipts", 4);
		await seedMessage(handle, "m1", "with-mail");
		await seedMessage(handle, "copied", "elsewhere");
		await handle.db
			.update(entities.messages)
			.set({ originalMailboxId: "older-empty" })
			.where(eq(entities.messages.messageId, "copied"));
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
		await handle.db.insert(entities.organizeJobRequests).values({
			organizeJobId: "job-1",
			accountConfigId: CONFIG,
			userId: "user",
			actionMailboxId: "older-empty",
			ttl: 0,
			createdAt: 0,
			updatedAt: 0,
		});
		await handle.db.insert(entities.messagePlacementMoves).values({
			messageId: "copied",
			accountId: ACCOUNT,
			accountConfigId: CONFIG,
			sourceMailboxId: "elsewhere",
			destinationMailboxId: "older-empty",
			createdAt: 0,
			updatedAt: 0,
		});
		await seedSetting(handle, "FolderRoleAppointment#acct#Archive", {
			kind: "String",
			value: "older-empty",
		});
		await handle.db.insert(entities.mailboxFlags).values({
			mailboxFlagId: "flag-1",
			mailboxId: "older-empty",
			flagName: "\\Seen",
			isPermanent: true,
		});

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), [
			"child",
			"elsewhere",
			"with-mail",
		]);
		const [child] = await handle.db
			.select({ parent: entities.mailboxes.parentMailboxId })
			.from(entities.mailboxes)
			.where(eq(entities.mailboxes.mailboxId, "child"));
		assert.equal(child?.parent, "with-mail");
		const [filter] = await handle.db.select().from(entities.filters);
		assert.equal(filter?.actionMailboxId, "with-mail");
		const [job] = await handle.db.select().from(entities.organizeJobRequests);
		assert.equal(job?.actionMailboxId, "with-mail");
		const [copied] = await handle.db
			.select({ original: entities.messages.originalMailboxId })
			.from(entities.messages)
			.where(eq(entities.messages.messageId, "copied"));
		assert.equal(copied?.original, "with-mail");
		const [move] = await handle.db
			.select()
			.from(entities.messagePlacementMoves);
		assert.equal(move?.destinationMailboxId, "with-mail");
		const [setting] = await handle.db.select().from(entities.accountSettings);
		assert.deepEqual(setting?.value, { kind: "String", value: "with-mail" });
		assert.deepEqual(await handle.db.select().from(entities.mailboxFlags), []);
		const index = (
			handle.sqlite.prepare("PRAGMA index_list(mailbox)").all() as Array<{
				name: string;
				unique: number;
			}>
		).find((entry) => entry.name === "mailbox_by_account_full_path");
		assert.equal(index?.unique, 1);
		handle.sqlite.close();
	});

	test("a muted losing folder stays muted, and the survivor's own name is kept", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "survivor", "Newsletters", 1);
		await seedMailbox(handle, "loser", "Newsletters", 2);
		await seedSetting(handle, "MailboxMuted#loser", {
			kind: "Muted",
			value: true,
		});
		await seedSetting(handle, "MailboxDisplayName#loser", {
			kind: "String",
			value: "Loser name",
		});
		await seedSetting(handle, "MailboxDisplayName#survivor", {
			kind: "String",
			value: "Survivor name",
		});

		dedupe(handle);

		const settings = await handle.db
			.select({
				name: entities.accountSettings.name,
				value: entities.accountSettings.value,
			})
			.from(entities.accountSettings)
			.orderBy(asc(entities.accountSettings.name));
		assert.deepEqual(settings, [
			{
				name: "MailboxDisplayName#survivor",
				value: { kind: "String", value: "Survivor name" },
			},
			{ name: "MailboxMuted#survivor", value: { kind: "Muted", value: true } },
		]);
		handle.sqlite.close();
	});

	test("the survivor is chosen by the mail it holds, not by message_count", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "claims-mail", "Archive", 1, {
			messageCount: 500,
		});
		await seedMailbox(handle, "holds-mail", "Archive", 2);
		await seedMessage(handle, "m1", "holds-mail", 1);
		await seedMessage(handle, "m2", "holds-mail", 2);

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["holds-mail"]);
		handle.sqlite.close();
	});

	test("with equal mail the oldest row survives", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "a-newer", "Archive", 2);
		await seedMailbox(handle, "b-older", "Archive", 1);

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["b-older"]);
		handle.sqlite.close();
	});

	test("with equal mail and age the lowest mailbox_id survives", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "b", "Archive", 1);
		await seedMailbox(handle, "a", "Archive", 1);

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["a"]);
		handle.sqlite.close();
	});

	test("mail the survivor already holds at that uid is parked, removed at boot, and re-fetched", async () => {
		const handle = atPredecessor();
		const cursor = {
			lastSyncUid: 1,
			highWaterMarkUid: 9,
			highestModseq: "900",
		};
		await seedMailbox(handle, "older", "Archive", 1, cursor);
		await seedMailbox(handle, "newer", "Archive", 2, cursor);
		await seedMessage(handle, "kept", "older", 7);
		await seedMessage(handle, "stale", "newer", 7);
		await seedMessage(handle, "unrelated", "no-such-folder", 1);

		dedupe(handle);

		assert.deepEqual(await mailboxIds(handle), ["older"]);
		assert.equal(await messagesIn(handle, PARKED_MAILBOX_ID), 1);
		assert.equal(await threadsIn(handle, PARKED_MAILBOX_ID), 1);
		assert.deepEqual(await survivorCursor(handle, "older"), {
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			highestModseq: "0",
		});

		const report = await sweepDuplicateMailboxMail(handle.db, "repair");

		assert.deepEqual(report, {
			mode: "repair",
			duplicatePaths: 0,
			parked: 1,
			removed: 1,
		});
		const messages = await handle.db
			.select({ messageId: entities.messages.messageId })
			.from(entities.messages)
			.orderBy(asc(entities.messages.messageId));
		assert.deepEqual(messages, [
			{ messageId: "kept" },
			{ messageId: "unrelated" },
		]);
		const events = await handle.db
			.select({ messageId: outboxTable.messageId, event: outboxTable.event })
			.from(outboxTable);
		assert.deepEqual(events, [
			{ messageId: "stale", event: MESSAGE_REMOVED_EVENT },
		]);
		assert.deepEqual(await sweepDuplicateMailboxMail(handle.db, "repair"), {
			mode: "repair",
			duplicatePaths: 0,
			parked: 0,
			removed: 0,
		});
		handle.sqlite.close();
	});

	test("the check before migrating reports the paths the migration will merge", async () => {
		const handle = atPredecessor();
		await seedMailbox(handle, "a", "Archive", 1);
		await seedMailbox(handle, "b", "Archive", 2);

		assert.deepEqual(await sweepDuplicateMailboxMail(handle.db, "check"), {
			mode: "check",
			duplicatePaths: 1,
			parked: 0,
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
