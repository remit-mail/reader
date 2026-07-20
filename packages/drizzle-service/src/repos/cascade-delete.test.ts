import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { MailboxCursorState } from "@remit/domain-enums";
import { eq } from "drizzle-orm";
import {
	accountSettingTable,
	accountTable,
	addressTable,
	bodyPartTable,
	envelopeTable,
	mailboxLockTable,
	mailboxTable,
	messageFlagPushTable,
	messageFlagTable,
	messagePlacementMoveTable,
	messageTable,
	outboxMessageTable,
	outboxTable,
	quarantineTable,
	threadMessageTable,
} from "../schema.js";
import { createTestDb, type TestDb } from "../test-db.js";
import {
	type CascadeEntity,
	runDrizzleCascadeDelete,
} from "./cascade-delete.js";

const log = { info: () => {} };

const NOW = 1700000000000;
const ACCOUNT_CONFIG_ID = "cfg-cascade-1";
const ACCOUNT_ID = "acc-cascade-1";
const MAILBOX_ID = "mbx-cascade-1";
const MESSAGE_ID = "msg-cascade-1";
const THREAD_MESSAGE_ID = "tm-cascade-1";
const OUTBOX_MESSAGE_ID = "outbox-cascade-1";
const ACCOUNT_SETTING_ID = "setting-cascade-1";
const ADDRESS_ID = "address-cascade-1";
const ENVELOPE_ID = "00000000-0000-4000-8000-000000000001";
const ROOT_BODY_PART_ID = "00000000-0000-4000-8000-000000000002";
const MESSAGE_FLAG_ID = "00000000-0000-4000-8000-000000000003";
const BODY_PART_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_MAILBOX_ID = "mbx-cascade-2";
const QUARANTINE_ID = "quarantine-cascade-1";

describe("runDrizzleCascadeDelete", () => {
	let db: TestDb;
	let close: () => Promise<void>;

	before(async () => {
		({ db, close } = await createTestDb());

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
		await db.insert(messageFlagTable).values({
			messageFlagId: MESSAGE_FLAG_ID,
			messageId: MESSAGE_ID,
			flagName: "\\Seen",
			setAt: NOW,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(bodyPartTable).values({
			bodyPartId: BODY_PART_ID,
			messageId: MESSAGE_ID,
			partPath: "1",
			mediaType: "TEXT",
			mediaSubtype: "plain",
			transferEncoding: "7BIT",
			sizeOctets: 4,
			isMultipart: false,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(threadMessageTable).values({
			threadMessageId: THREAD_MESSAGE_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			threadId: "thread-1",
			messageId: MESSAGE_ID,
			mailboxId: MAILBOX_ID,
			uid: 1,
			referenceOrder: 0,
			internalDate: NOW,
			sentDate: NOW,
			isRead: false,
			hasAttachment: false,
			star: "none",
			hasStars: false,
			isDeleted: false,
			category: "uncategorized",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(outboxMessageTable).values({
			outboxMessageId: OUTBOX_MESSAGE_ID,
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			fromAddress: "u@example.com",
			toAddresses: ["b@example.com"],
			ccAddresses: [],
			bccAddresses: [],
			messageIdValue: "<x@example.com>",
			references: [],
			status: "queued",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(mailboxLockTable).values({
			mailboxId: MAILBOX_ID,
			eventName: "SYNC_MESSAGES",
			accountId: ACCOUNT_ID,
			lockId: "lock-1",
			acquiredAt: NOW,
			lockedBy: "worker-1",
			ttl: NOW + 60000,
		});
		await db.insert(accountSettingTable).values({
			accountSettingId: ACCOUNT_SETTING_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			name: "Theme",
			value: { mode: "dark" },
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(addressTable).values({
			addressId: ADDRESS_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			localPart: "u",
			domain: "example.com",
			normalizedEmail: "u@example.com",
			normalizedCompound: "u u@example.com",
			flags: {},
			inboundCount: 0,
			outboundCount: 0,
			replyCount: 0,
			lastInboundAt: NOW,
			lastReplyAt: NOW,
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(messagePlacementMoveTable).values({
			messageId: MESSAGE_ID,
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			sourceMailboxId: MAILBOX_ID,
			destinationMailboxId: OTHER_MAILBOX_ID,
			state: "pending",
			createdAt: NOW,
			updatedAt: NOW,
		});
		await db.insert(messageFlagPushTable).values([
			{
				messageId: MESSAGE_ID,
				flagName: "\\Seen",
				accountId: ACCOUNT_ID,
				accountConfigId: ACCOUNT_CONFIG_ID,
				mailboxId: MAILBOX_ID,
				operation: "add",
				state: "pending",
				createdAt: NOW,
				updatedAt: NOW,
			},
			{
				messageId: MESSAGE_ID,
				flagName: "\\Flagged",
				accountId: ACCOUNT_ID,
				accountConfigId: ACCOUNT_CONFIG_ID,
				mailboxId: MAILBOX_ID,
				operation: "remove",
				state: "pending",
				createdAt: NOW,
				updatedAt: NOW,
			},
		]);

		await db.insert(quarantineTable).values({
			quarantineId: QUARANTINE_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			mailboxId: MAILBOX_ID,
			uidValidity: 1_712_000_000,
			uid: 40217,
			mailboxPath: "Clients/Acme Holdings",
			quarantinedAt: NOW,
			attempts: 3,
			failureStage: "BodyParse",
			failureCode: "UnterminatedMultipartBoundary",
			failureMessage: "multipart boundary was never closed",
			workerVersion: "worker 1.0.0",
			structure: [{ depth: 0, contentType: "multipart/mixed" }],
			createdAt: NOW,
			updatedAt: NOW,
		});
	});

	after(async () => {
		await close();
	});

	const entities: CascadeEntity[] = [
		// Message + its enumerated children — the children are removed by message id.
		{ entityType: "Message", key: { messageId: MESSAGE_ID } },
		{ entityType: "MessageFlag", key: { messageFlagId: MESSAGE_FLAG_ID } },
		{ entityType: "Envelope", key: { envelopeId: ENVELOPE_ID } },
		{ entityType: "BodyPart", key: { bodyPartId: BODY_PART_ID } },
		{
			entityType: "ThreadMessage",
			key: {
				accountConfigId: ACCOUNT_CONFIG_ID,
				threadMessageId: THREAD_MESSAGE_ID,
			},
		},
		{ entityType: "Mailbox", key: { mailboxId: MAILBOX_ID } },
		{
			entityType: "OutboxMessage",
			key: { outboxMessageId: OUTBOX_MESSAGE_ID },
		},
		{
			entityType: "MailboxLock",
			key: { mailboxId: MAILBOX_ID, eventName: "SYNC_MESSAGES" },
		},
		{
			entityType: "AccountSetting",
			key: { accountSettingId: ACCOUNT_SETTING_ID },
		},
		{ entityType: "Address", key: { addressId: ADDRESS_ID } },
		{ entityType: "Account", key: { accountId: ACCOUNT_ID } },
		{
			entityType: "MessagePlacementMove",
			key: { messageId: MESSAGE_ID },
		},
		{
			entityType: "MessageFlagPush",
			key: { messageId: MESSAGE_ID, flagName: "\\Seen" },
		},
		{
			entityType: "MessageFlagPush",
			key: { messageId: MESSAGE_ID, flagName: "\\Flagged" },
		},
	];

	test("deletes every enumerated row across all tables", async () => {
		await runDrizzleCascadeDelete(db as never, entities, log);

		assert.equal(
			(
				await db
					.select()
					.from(messageTable)
					.where(eq(messageTable.messageId, MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(messageFlagTable)
					.where(eq(messageFlagTable.messageId, MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(bodyPartTable)
					.where(eq(bodyPartTable.messageId, MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(envelopeTable)
					.where(eq(envelopeTable.messageId, MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(threadMessageTable)
					.where(eq(threadMessageTable.threadMessageId, THREAD_MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(mailboxTable)
					.where(eq(mailboxTable.mailboxId, MAILBOX_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(outboxMessageTable)
					.where(eq(outboxMessageTable.outboxMessageId, OUTBOX_MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(mailboxLockTable)
					.where(eq(mailboxLockTable.mailboxId, MAILBOX_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(accountSettingTable)
					.where(eq(accountSettingTable.accountSettingId, ACCOUNT_SETTING_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(addressTable)
					.where(eq(addressTable.addressId, ADDRESS_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(accountTable)
					.where(eq(accountTable.accountId, ACCOUNT_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(messagePlacementMoveTable)
					.where(eq(messagePlacementMoveTable.messageId, MESSAGE_ID))
			).length,
			0,
		);
		assert.equal(
			(
				await db
					.select()
					.from(messageFlagPushTable)
					.where(eq(messageFlagPushTable.messageId, MESSAGE_ID))
			).length,
			0,
			"both the Seen and Flagged markers (composite key) must be deleted",
		);
		assert.equal(
			(
				await db
					.select()
					.from(quarantineTable)
					.where(eq(quarantineTable.quarantineId, QUARANTINE_ID))
			).length,
			0,
			"quarantine rows carry the user's folder names and parser output, so account deletion must take them",
		);
	});

	test("emits a message.removed outbox row for search-index cleanup", async () => {
		const rows = await db
			.select()
			.from(outboxTable)
			.where(eq(outboxTable.messageId, MESSAGE_ID));
		assert.equal(rows.length, 1);
		assert.equal(rows[0].event, "message.removed");
		assert.equal(rows[0].processedAt, null);
	});

	test("rejects an unknown entity type without deleting", async () => {
		await assert.rejects(
			() =>
				runDrizzleCascadeDelete(
					db as never,
					[{ entityType: "Nonsense", key: { id: "x" } }],
					log,
				),
			/Unknown entity type in cascade: Nonsense/,
		);
	});
});
