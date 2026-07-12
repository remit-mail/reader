import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { accountTable } from "../schema/i4-account-config.js";
import { accountSettingTable } from "../schema/i4-account-setting.js";
import { addressTable } from "../schema/i4-address.js";
import { mailboxTable } from "../schema/i4-mailbox.js";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";
import { messageFlagPushTable } from "../schema/i4-message-flag-push.js";
import { messagePlacementMoveTable } from "../schema/i4-message-placement-move.js";
import { outboxMessageTable } from "../schema/i4-outbox-message.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { deleteMessageSubtree, type SubtreeDb } from "./message.js";

export interface CascadeEntity {
	entityType: string;
	key: Record<string, string>;
}

export interface CascadeDeleteLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

type CascadeDb = NodePgDatabase<Record<string, unknown>>;

/**
 * Per-message entity types. Their rows are removed with the message subtree by
 * message id, so their individually-enumerated keys are not deleted one by one —
 * the DynamoDB cascade enumerates them only because BatchWriteItem needs each
 * full key; Postgres deletes them set-wise by message id.
 */
const MESSAGE_CHILD_TYPES = new Set([
	"MessageFlag",
	"MessageReference",
	"EnvelopeAddress",
	"Envelope",
	"BodyPart",
	"BodyPartParameter",
	"BodyPartStorage",
	"BodyPartContent",
	"RawMessageStorage",
]);

const KEYED_TYPES = new Set([
	"Message",
	"ThreadMessage",
	"Mailbox",
	"OutboxMessage",
	"MailboxLock",
	"AccountSetting",
	"Address",
	"Account",
	"MessagePlacementMove",
	"MessageFlagPush",
]);

const groupByType = (
	entities: CascadeEntity[],
): Map<string, Record<string, string>[]> => {
	const grouped = new Map<string, Record<string, string>[]>();
	for (const entity of entities) {
		const list = grouped.get(entity.entityType) ?? [];
		list.push(entity.key);
		grouped.set(entity.entityType, list);
	}
	return grouped;
};

/**
 * Postgres equivalent of the DynamoDB BatchWriteItem cascade: delete every
 * enumerated row for an account/tenant in one transaction. Message subtrees
 * (message + nine child tables) are deleted set-wise by message id and emit a
 * `message.removed` outbox row each for search-index cleanup; the remaining
 * entity types are deleted by their enumerated primary keys. AccountConfig is
 * never deleted here — the caller removes it last through its repository, the
 * cascade-in-progress marker.
 */
export const runDrizzleCascadeDelete = async (
	db: CascadeDb,
	entities: CascadeEntity[],
	log: CascadeDeleteLogger,
): Promise<void> => {
	const grouped = groupByType(entities);

	for (const entityType of grouped.keys()) {
		if (MESSAGE_CHILD_TYPES.has(entityType)) continue;
		if (!KEYED_TYPES.has(entityType)) {
			throw new Error(`Unknown entity type in cascade: ${entityType}`);
		}
	}

	await db.transaction(async (tx) => {
		const messageIds = (grouped.get("Message") ?? []).map((k) => k.messageId);
		await deleteMessageSubtree(tx as unknown as SubtreeDb, messageIds);

		const threadMessageIds = (grouped.get("ThreadMessage") ?? []).map(
			(k) => k.threadMessageId,
		);
		if (threadMessageIds.length > 0) {
			await tx
				.delete(threadMessageTable)
				.where(inArray(threadMessageTable.threadMessageId, threadMessageIds));
		}

		const mailboxIds = (grouped.get("Mailbox") ?? []).map((k) => k.mailboxId);
		if (mailboxIds.length > 0) {
			await tx
				.delete(mailboxTable)
				.where(inArray(mailboxTable.mailboxId, mailboxIds));
		}

		const outboxMessageIds = (grouped.get("OutboxMessage") ?? []).map(
			(k) => k.outboxMessageId,
		);
		if (outboxMessageIds.length > 0) {
			await tx
				.delete(outboxMessageTable)
				.where(inArray(outboxMessageTable.outboxMessageId, outboxMessageIds));
		}

		const lockKeys = grouped.get("MailboxLock") ?? [];
		if (lockKeys.length > 0) {
			const conditions: SQL[] = lockKeys.map((k) =>
				and(
					eq(mailboxLockTable.mailboxId, k.mailboxId),
					eq(mailboxLockTable.eventName, k.eventName),
				),
			) as SQL[];
			await tx.delete(mailboxLockTable).where(or(...conditions));
		}

		const accountSettingIds = (grouped.get("AccountSetting") ?? []).map(
			(k) => k.accountSettingId,
		);
		if (accountSettingIds.length > 0) {
			await tx
				.delete(accountSettingTable)
				.where(
					inArray(accountSettingTable.accountSettingId, accountSettingIds),
				);
		}

		const addressIds = (grouped.get("Address") ?? []).map((k) => k.addressId);
		if (addressIds.length > 0) {
			await tx
				.delete(addressTable)
				.where(inArray(addressTable.addressId, addressIds));
		}

		const accountIds = (grouped.get("Account") ?? []).map((k) => k.accountId);
		if (accountIds.length > 0) {
			await tx
				.delete(accountTable)
				.where(inArray(accountTable.accountId, accountIds));
		}

		const placementMoveMessageIds = (
			grouped.get("MessagePlacementMove") ?? []
		).map((k) => k.messageId);
		if (placementMoveMessageIds.length > 0) {
			await tx
				.delete(messagePlacementMoveTable)
				.where(
					inArray(messagePlacementMoveTable.messageId, placementMoveMessageIds),
				);
		}

		// Composite key (messageId, flagName) — a message can carry an
		// independent pending read-state marker and pending star marker at once
		// (issue #1273), so a single-column inArray cannot target one row.
		const flagPushKeys = grouped.get("MessageFlagPush") ?? [];
		if (flagPushKeys.length > 0) {
			const conditions: SQL[] = flagPushKeys.map((k) =>
				and(
					eq(messageFlagPushTable.messageId, k.messageId),
					eq(messageFlagPushTable.flagName, k.flagName),
				),
			) as SQL[];
			await tx.delete(messageFlagPushTable).where(or(...conditions));
		}
	});

	log.info({ entityCount: entities.length }, "Drizzle cascade delete complete");
};

export type CascadeDeleter = (
	entities: CascadeEntity[],
	log: CascadeDeleteLogger,
) => Promise<void>;

/**
 * Bind a cascade deleter to one Postgres connection. The account worker builds
 * this once at module load on the `DATA_BACKEND=postgres` path and reuses it
 * across invocations; the underlying pool is shared with no per-purge setup.
 */
export const createCascadeDeleter = (connectionUrl: string): CascadeDeleter => {
	const db = drizzle(connectionUrl) as CascadeDb;
	return (entities, log) => runDrizzleCascadeDelete(db, entities, log);
};
