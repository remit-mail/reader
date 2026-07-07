import { randomUUID } from "node:crypto";
import type {
	CreateMessageInput,
	IMessageRepository,
	MessageDescription,
	MessageItem,
} from "@remit/data-ports";
import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Db } from "../db.js";
import {
	CreateFailedConflictError,
	isUniqueViolation,
	NotFoundError,
} from "../error.js";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import {
	bodyPartContentTable,
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	envelopeAddressTable,
	envelopeTable,
	type MessageDataSchema,
	messageFlagTable,
	messageReferenceTable,
	messageTable,
	outboxTable,
	rawMessageStorageTable,
} from "../schema/message-data.js";
import {
	toBodyPartContentItem,
	toBodyPartItem,
	toBodyPartParameterItem,
	toBodyPartStorageItem,
	toEnvelopeAddressItem,
	toEnvelopeItem,
	toMessageReferenceItem,
	toRawMessageStorageItem,
} from "./mappers.js";

type DB = Db<MessageDataSchema>;

function toMessageItem(row: typeof messageTable.$inferSelect): MessageItem {
	return {
		messageId: row.messageId,
		mailboxId: row.mailboxId,
		uid: row.uid,
		sequenceNumber: row.sequenceNumber,
		rfc822Size: row.rfc822Size,
		internalDate: row.internalDate,
		envelopeId: row.envelopeId,
		rootBodyPartId: row.rootBodyPartId,
		status: row.status,
		syncStatus: row.syncStatus,
		category: row.category,
		hasListUnsubscribe: row.hasListUnsubscribe,
		movedByRemit: row.movedByRemit,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.messageIdHeader !== null
			? { messageIdHeader: row.messageIdHeader }
			: {}),
		...(row.bodyStorageKey !== null
			? { bodyStorageKey: row.bodyStorageKey }
			: {}),
		...(row.originalMailboxId !== null
			? { originalMailboxId: row.originalMailboxId }
			: {}),
		...(row.originalUid !== null ? { originalUid: row.originalUid } : {}),
		...(row.authenticity !== null
			? { authenticity: row.authenticity as MessageItem["authenticity"] }
			: {}),
		...(row.authResult !== null
			? { authResult: row.authResult as MessageItem["authResult"] }
			: {}),
		...(row.providerSpam !== null
			? { providerSpam: row.providerSpam as MessageItem["providerSpam"] }
			: {}),
		...(row.placementVerdict !== null
			? {
					placementVerdict:
						row.placementVerdict as MessageItem["placementVerdict"],
				}
			: {}),
	};
}

/**
 * Emitted into the transactional outbox when a message's rows are deleted, so
 * the pg-index worker relays a search-index REMOVE and the vectors are dropped.
 * The Postgres-parity equivalent of the DynamoDB stream's REMOVE record.
 */
export const MESSAGE_REMOVED_EVENT = "message.removed";

export type SubtreeDb = Pick<
	NodePgDatabase<Record<string, unknown>>,
	"delete" | "insert"
>;

/**
 * Delete a message and its whole per-message subtree by message id — the nine
 * child tables, the message row, and its prior CDC outbox rows — then append one
 * `message.removed` outbox row per id so search-index cleanup rides the same
 * transactional outbox as body-sync and move. Runs inside a caller-supplied
 * transaction so the row delete and the removal event commit atomically.
 */
export async function deleteMessageSubtree(
	tx: SubtreeDb,
	messageIds: string[],
): Promise<void> {
	if (messageIds.length === 0) return;

	await tx
		.delete(messageFlagTable)
		.where(inArray(messageFlagTable.messageId, messageIds));
	await tx
		.delete(messageReferenceTable)
		.where(inArray(messageReferenceTable.messageId, messageIds));
	await tx
		.delete(envelopeAddressTable)
		.where(inArray(envelopeAddressTable.messageId, messageIds));
	await tx
		.delete(bodyPartParameterTable)
		.where(inArray(bodyPartParameterTable.messageId, messageIds));
	await tx
		.delete(bodyPartStorageTable)
		.where(inArray(bodyPartStorageTable.messageId, messageIds));
	await tx
		.delete(bodyPartContentTable)
		.where(inArray(bodyPartContentTable.messageId, messageIds));
	await tx
		.delete(rawMessageStorageTable)
		.where(inArray(rawMessageStorageTable.messageId, messageIds));
	await tx
		.delete(bodyPartTable)
		.where(inArray(bodyPartTable.messageId, messageIds));
	await tx
		.delete(envelopeTable)
		.where(inArray(envelopeTable.messageId, messageIds));
	await tx
		.delete(messageTable)
		.where(inArray(messageTable.messageId, messageIds));

	await tx
		.delete(outboxTable)
		.where(inArray(outboxTable.messageId, messageIds));
	await tx.insert(outboxTable).values(
		messageIds.map((messageId) => ({
			id: randomUUID(),
			messageId,
			event: MESSAGE_REMOVED_EVENT,
			payload: { messageId },
			createdAt: new Date(),
		})),
	);
}

export class DrizzleMessageRepository implements IMessageRepository {
	constructor(private db: DB) {}

	async create(input: CreateMessageInput): Promise<MessageItem> {
		const now = Date.now();
		const row = {
			messageId: input.messageId,
			mailboxId: input.mailboxId,
			uid: input.uid,
			sequenceNumber: input.sequenceNumber,
			rfc822Size: input.rfc822Size,
			internalDate: input.internalDate,
			envelopeId: deriveEnvelopeId(input.messageId),
			rootBodyPartId: deriveRootBodyPartId(input.messageId),
			status: input.status ?? ("active" as const),
			syncStatus: input.syncStatus ?? ("pending" as const),
			category: input.category ?? ("uncategorized" as const),
			hasListUnsubscribe: input.hasListUnsubscribe ?? false,
			movedByRemit: input.movedByRemit ?? false,
			messageIdHeader: input.messageIdHeader ?? null,
			bodyStorageKey: input.bodyStorageKey ?? null,
			originalMailboxId: input.originalMailboxId ?? null,
			originalUid: input.originalUid ?? null,
			authenticity: input.authenticity ?? null,
			authResult: input.authResult ?? null,
			providerSpam: input.providerSpam ?? null,
			placementVerdict: input.placementVerdict ?? null,
			createdAt: now,
			updatedAt: now,
		};

		// Faithful to ElectroDB message.create: a duplicate messageId throws
		// CreateFailedConflictError. The plain insert raises a PG unique
		// violation, which rolls back the transaction so NO outbox row is
		// written; we surface it as the domain conflict error.
		try {
			await this.db.transaction(async (tx) => {
				await tx.insert(messageTable).values(row);

				await tx.insert(outboxTable).values({
					id: randomUUID(),
					messageId: input.messageId,
					event: "message.created",
					payload: { messageId: input.messageId },
					createdAt: new Date(),
				});
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new CreateFailedConflictError("Message", input);
			}
			throw error;
		}

		return this.get(input.messageId);
	}

	upsert(input: CreateMessageInput): Promise<MessageItem> {
		return this.upsertWithStatus(input).then((result) => result.item);
	}

	async upsertWithStatus(
		input: CreateMessageInput,
	): Promise<{ item: MessageItem; created: boolean }> {
		const existing = await this.db
			.select()
			.from(messageTable)
			.where(eq(messageTable.messageId, input.messageId));

		if (existing.length > 0) {
			return { item: toMessageItem(existing[0]), created: false };
		}

		const item = await this.create(input);
		return { item, created: true };
	}

	async get(messageId: string): Promise<MessageItem>;
	async get(messageIds: string[]): Promise<MessageItem[]>;
	async get(
		messageId: string | string[],
	): Promise<MessageItem | MessageItem[]> {
		if (Array.isArray(messageId)) {
			if (messageId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(messageTable)
				.where(inArray(messageTable.messageId, messageId));
			return rows.map(toMessageItem);
		}

		const rows = await this.db
			.select()
			.from(messageTable)
			.where(eq(messageTable.messageId, messageId));
		if (rows.length === 0) {
			throw new NotFoundError(`Message not found: ${messageId}`);
		}
		return toMessageItem(rows[0]);
	}

	async describe(messageId: string): Promise<MessageDescription> {
		const [
			messages,
			messageFlags,
			envelopes,
			messageReferences,
			envelopeAddresses,
			bodyParts,
			bodyPartParameters,
			rawMessageStorages,
			bodyPartStorages,
			bodyPartContents,
		] = await Promise.all([
			this.db
				.select()
				.from(messageTable)
				.where(eq(messageTable.messageId, messageId)),
			this.db
				.select()
				.from(messageFlagTable)
				.where(eq(messageFlagTable.messageId, messageId)),
			this.db
				.select()
				.from(envelopeTable)
				.where(eq(envelopeTable.messageId, messageId)),
			this.db
				.select()
				.from(messageReferenceTable)
				.where(eq(messageReferenceTable.messageId, messageId)),
			this.db
				.select()
				.from(envelopeAddressTable)
				.where(eq(envelopeAddressTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartTable)
				.where(eq(bodyPartTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartParameterTable)
				.where(eq(bodyPartParameterTable.messageId, messageId)),
			this.db
				.select()
				.from(rawMessageStorageTable)
				.where(eq(rawMessageStorageTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartStorageTable)
				.where(eq(bodyPartStorageTable.messageId, messageId)),
			this.db
				.select()
				.from(bodyPartContentTable)
				.where(eq(bodyPartContentTable.messageId, messageId)),
		]);

		if (messages.length === 0) {
			throw new NotFoundError(`Message not found: ${messageId}`);
		}

		return {
			message: messages.map(toMessageItem),
			messageFlag: messageFlags.map((row) => ({
				messageFlagId: row.messageFlagId,
				messageId: row.messageId,
				flagName: row.flagName,
				setAt: row.setAt,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			})),
			envelope: envelopes.map(toEnvelopeItem),
			messageReference: messageReferences.map(toMessageReferenceItem),
			envelopeAddress: envelopeAddresses.map(toEnvelopeAddressItem),
			bodyPart: bodyParts.map(toBodyPartItem),
			bodyPartParameter: bodyPartParameters.map(toBodyPartParameterItem),
			rawMessageStorage: rawMessageStorages.map(toRawMessageStorageItem),
			bodyPartStorage: bodyPartStorages.map(toBodyPartStorageItem),
			bodyPartContent: bodyPartContents.map(toBodyPartContentItem),
		};
	}

	async update(
		messageId: string,
		input: Parameters<IMessageRepository["update"]>[1],
	): ReturnType<IMessageRepository["update"]> {
		const now = Date.now();
		const setValues = {
			...(input.bodyStorageKey !== undefined
				? { bodyStorageKey: input.bodyStorageKey }
				: {}),
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.syncStatus !== undefined
				? { syncStatus: input.syncStatus }
				: {}),
			...(input.category !== undefined ? { category: input.category } : {}),
			...(input.hasListUnsubscribe !== undefined
				? { hasListUnsubscribe: input.hasListUnsubscribe }
				: {}),
			...(input.movedByRemit !== undefined
				? { movedByRemit: input.movedByRemit }
				: {}),
			...(input.authenticity !== undefined
				? { authenticity: input.authenticity }
				: {}),
			...(input.authResult !== undefined
				? { authResult: input.authResult }
				: {}),
			...(input.providerSpam !== undefined
				? { providerSpam: input.providerSpam }
				: {}),
			...(input.placementVerdict !== undefined
				? { placementVerdict: input.placementVerdict }
				: {}),
			...(input.messageIdHeader !== undefined
				? { messageIdHeader: input.messageIdHeader }
				: {}),
			updatedAt: now,
		};

		// A non-empty bodyStorageKey means body-sync just persisted the parsed
		// body, so the message now has embeddable content and its threadMessage
		// exists. Append a search-index event in the same transaction as the write
		// (transactional outbox) — the pg-index worker relays it to SQS and embeds.
		// The outbox is append-only: the worker's content-hash gate makes a
		// redundant pass near-free.
		const bodySynced =
			typeof input.bodyStorageKey === "string" &&
			input.bodyStorageKey.length > 0;

		await this.db.transaction(async (tx) => {
			await tx
				.update(messageTable)
				.set(setValues)
				.where(eq(messageTable.messageId, messageId));

			if (bodySynced) {
				await tx.insert(outboxTable).values({
					id: randomUUID(),
					messageId,
					event: "message.body_synced",
					payload: { messageId },
					createdAt: new Date(),
				});
			}
		});
		return this.get(messageId);
	}

	async clearBodyStorageKey(
		messageId: string,
	): ReturnType<IMessageRepository["clearBodyStorageKey"]> {
		const now = Date.now();
		await this.db
			.update(messageTable)
			.set({ bodyStorageKey: null, updatedAt: now })
			.where(eq(messageTable.messageId, messageId));
		return this.get(messageId);
	}

	async delete(messageId: string): Promise<void> {
		await this.deleteMany([messageId]);
	}

	async deleteMany(messageIds: string[]): Promise<void> {
		if (messageIds.length === 0) return;
		await this.db.transaction((tx) =>
			deleteMessageSubtree(tx as unknown as SubtreeDb, messageIds),
		);
	}

	async listByMailbox(
		mailboxId: string,
		options?: Parameters<IMessageRepository["listByMailbox"]>[1],
	): ReturnType<IMessageRepository["listByMailbox"]> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? { uid: cursor.uid as number, messageId: cursor.messageId as string }
			: undefined;

		const rows = await this.db
			.select()
			.from(messageTable)
			.where(
				and(
					eq(messageTable.mailboxId, mailboxId),
					after
						? or(
								gt(messageTable.uid, after.uid),
								and(
									eq(messageTable.uid, after.uid),
									gt(messageTable.messageId, after.messageId),
								),
							)
						: undefined,
				),
			)
			.orderBy(asc(messageTable.uid), asc(messageTable.messageId))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(toMessageItem);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? { uid: lastItem.uid, messageId: lastItem.messageId }
				: undefined,
		);
	}

	async listAllByMailbox(
		mailboxId: string,
	): ReturnType<IMessageRepository["listAllByMailbox"]> {
		const rows = await this.db
			.select()
			.from(messageTable)
			.where(eq(messageTable.mailboxId, mailboxId))
			.orderBy(asc(messageTable.uid), asc(messageTable.messageId));
		return rows.map(toMessageItem);
	}

	async updateForMove(
		messageId: string,
		input: Parameters<IMessageRepository["updateForMove"]>[1],
	): ReturnType<IMessageRepository["updateForMove"]> {
		const setValues = {
			...(input.mailboxId !== undefined ? { mailboxId: input.mailboxId } : {}),
			...(input.uid !== undefined ? { uid: input.uid } : {}),
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.syncStatus !== undefined
				? { syncStatus: input.syncStatus }
				: {}),
			...(input.originalMailboxId !== undefined
				? { originalMailboxId: input.originalMailboxId }
				: {}),
			...(input.originalUid !== undefined
				? { originalUid: input.originalUid }
				: {}),
			updatedAt: Date.now(),
		};

		const rows = await this.db
			.update(messageTable)
			.set(setValues)
			.where(eq(messageTable.messageId, messageId))
			.returning();
		if (rows.length === 0) {
			throw new NotFoundError(`Message not found: ${messageId}`);
		}
		return toMessageItem(rows[0]);
	}

	async updateUid(
		messageId: string,
		newUid: number,
		newMailboxId: string,
	): ReturnType<IMessageRepository["updateUid"]> {
		// updateUid settles a move against confirmed IMAP state (the destination
		// mailbox and its COPYUID). The message's search vectors still carry the
		// old mailbox in their metadata and their body is unchanged, so a normal
		// re-index would skip them on content hash. Enqueue a move re-index event
		// in the same transaction as the update; the pg-index worker drains it
		// with force, refreshing the stored mailbox metadata.
		const rows = await this.db.transaction(async (tx) => {
			const updated = await tx
				.update(messageTable)
				.set({
					uid: newUid,
					mailboxId: newMailboxId,
					status: "active",
					syncStatus: "synced",
					updatedAt: Date.now(),
				})
				.where(eq(messageTable.messageId, messageId))
				.returning();
			if (updated.length === 0) {
				throw new NotFoundError(`Message not found: ${messageId}`);
			}

			await tx.insert(outboxTable).values({
				id: randomUUID(),
				messageId,
				event: "message.moved",
				payload: { messageId },
				createdAt: new Date(),
			});
			return updated;
		});
		return toMessageItem(rows[0]);
	}
}
