import type {
	CreateMessageInput,
	IMessageRepository,
	MessageDescription,
	MessageItem,
	PlacementPredicate,
} from "@remit/data-ports";
import {
	and,
	asc,
	eq,
	exists,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	type SQL,
} from "drizzle-orm";
import type { SqliteBatchItem, WriteBatch } from "../batch.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
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
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	bodyStructureRefetchTable,
	envelopeAddressTable,
	envelopeTable,
	messageFlagTable,
	messageReferenceTable,
	messageSearchTextTable,
	messageTable,
	rawMessageStorageTable,
} from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import type { SearchIndex } from "../search/thread-message-search.js";
import { inList } from "./in-list.js";
import {
	toBodyPartItem,
	toBodyPartParameterItem,
	toBodyPartStorageItem,
	toEnvelopeAddressItem,
	toEnvelopeItem,
	toMessageReferenceItem,
	toRawMessageStorageItem,
} from "./mappers.js";
import type { MessageObjects } from "./message-objects.js";

type DB = RepositoryDb<Record<string, unknown>>;

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
		abandonedMutation: row.abandonedMutation,
		syncStatus: row.syncStatus,
		category: row.category,
		classificationState: row.classificationState,
		authenticityVerdict: row.authenticityVerdict,
		hasListUnsubscribe: row.hasListUnsubscribe,
		movedByRemit: row.movedByRemit,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
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
		...(row.filterMove !== null
			? { filterMove: row.filterMove as MessageItem["filterMove"] }
			: {}),
		...(row.placementDecidedAt !== null
			? { placementDecidedAt: row.placementDecidedAt }
			: {}),
		...(row.spamReport !== null
			? { spamReport: row.spamReport as MessageItem["spamReport"] }
			: {}),
	};
}

export type SubtreeDb = Pick<
	RepositoryDb<Record<string, unknown>>,
	"delete" | "select"
>;

/**
 * The statements that delete a message and its whole per-message subtree by
 * message id: the child tables, then the message row. The caller runs them as
 * one batch so the subtree goes atomically. `removed` reads the rows the batch
 * deletes; it goes first, so it sees them under the same guard. `guard` rides
 * every statement, so a guard that reads the message row holds until the last
 * statement removes it.
 */
export function deleteMessageSubtree(
	db: SubtreeDb,
	messageIds: string[],
	guard?: SQL,
) {
	const removed = db
		.select({
			messageId: messageTable.messageId,
			bodyStorageKey: messageTable.bodyStorageKey,
		})
		.from(messageTable)
		.where(and(inList(messageTable.messageId, messageIds), guard));
	if (messageIds.length === 0) return { removed, statements: [] };
	const statements: SqliteBatchItem[] = [
		db
			.delete(messageFlagTable)
			.where(and(inList(messageFlagTable.messageId, messageIds), guard)),
		db
			.delete(messageReferenceTable)
			.where(and(inList(messageReferenceTable.messageId, messageIds), guard)),
		db
			.delete(envelopeAddressTable)
			.where(and(inList(envelopeAddressTable.messageId, messageIds), guard)),
		db
			.delete(bodyPartParameterTable)
			.where(and(inList(bodyPartParameterTable.messageId, messageIds), guard)),
		db
			.delete(bodyPartStorageTable)
			.where(and(inList(bodyPartStorageTable.messageId, messageIds), guard)),
		db
			.delete(rawMessageStorageTable)
			.where(and(inList(rawMessageStorageTable.messageId, messageIds), guard)),
		db
			.delete(bodyPartTable)
			.where(and(inList(bodyPartTable.messageId, messageIds), guard)),
		db
			.delete(bodyStructureRefetchTable)
			.where(
				and(inList(bodyStructureRefetchTable.messageId, messageIds), guard),
			),
		db
			.delete(messageSearchTextTable)
			.where(and(inList(messageSearchTextTable.messageId, messageIds), guard)),
		db
			.delete(envelopeTable)
			.where(and(inList(envelopeTable.messageId, messageIds), guard)),
		db
			.delete(messageTable)
			.where(and(inList(messageTable.messageId, messageIds), guard)),
	];
	return { removed, statements };
}

/**
 * The WHERE terms of a placement transition (imap-mutations R3). A field the
 * caller left out is a field it did not read, so it constrains nothing; a field
 * given as a list matches any of the states that share one column value.
 */
const isList = <T>(value: T | readonly T[]): value is readonly T[] =>
	Array.isArray(value);

const oneOf = <T>(value: T | readonly T[]): T[] =>
	isList(value) ? [...value] : [value];

const placementTerms = (expected: PlacementPredicate): SQL[] => {
	const terms: SQL[] = [];
	if (expected.status !== undefined) {
		terms.push(inArray(messageTable.status, oneOf(expected.status)));
	}
	if (expected.syncStatus !== undefined) {
		terms.push(inArray(messageTable.syncStatus, oneOf(expected.syncStatus)));
	}
	if (expected.mailboxId !== undefined) {
		terms.push(eq(messageTable.mailboxId, expected.mailboxId));
	}
	if (expected.uid !== undefined) {
		terms.push(eq(messageTable.uid, expected.uid));
	}
	return terms;
};

export class DrizzleMessageRepository implements IMessageRepository {
	private readonly db: DB;
	private readonly batch: WriteBatch;

	constructor(
		store: SqliteStore<Record<string, unknown>>,
		private search: SearchIndex,
		private messageObjects: MessageObjects,
	) {
		this.db = store.db;
		this.batch = store.batch;
	}

	private rowOf(input: CreateMessageInput) {
		const now = Date.now();
		return {
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
			classificationState:
				input.classificationState ?? ("NotExamined" as const),
			authenticityVerdict:
				input.authenticityVerdict ?? ("NotEvaluated" as const),
			hasListUnsubscribe: input.hasListUnsubscribe ?? false,
			movedByRemit: input.movedByRemit ?? false,
			bodyStorageKey: input.bodyStorageKey ?? null,
			originalMailboxId: input.originalMailboxId ?? null,
			originalUid: input.originalUid ?? null,
			authenticity: input.authenticity ?? null,
			authResult: input.authResult ?? null,
			providerSpam: input.providerSpam ?? null,
			placementVerdict: input.placementVerdict ?? null,
			filterMove: input.filterMove ?? null,
			placementDecidedAt: input.placementDecidedAt ?? null,
			spamReport: input.spamReport ?? null,
			createdAt: now,
			updatedAt: now,
		};
	}

	async create(input: CreateMessageInput): Promise<MessageItem> {
		const row = this.rowOf(input);

		// Faithful to ElectroDB message.create: a duplicate messageId raises a
		// unique-constraint violation, surfaced as the domain conflict error.
		try {
			await this.db.insert(messageTable).values(row);
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
		const [inserted] = await this.db
			.insert(messageTable)
			.values(this.rowOf(input))
			.onConflictDoNothing({ target: messageTable.messageId })
			.returning();
		if (inserted) return { item: toMessageItem(inserted), created: true };
		return { item: await this.get(input.messageId), created: false };
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
				.where(inList(messageTable.messageId, messageId));
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
			...(input.category !== undefined ? { category: input.category } : {}),
			...(input.classificationState !== undefined
				? { classificationState: input.classificationState }
				: {}),
			...(input.authenticityVerdict !== undefined
				? { authenticityVerdict: input.authenticityVerdict }
				: {}),
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
			...(input.filterMove !== undefined
				? { filterMove: input.filterMove }
				: {}),
			...(input.placementDecidedAt !== undefined
				? { placementDecidedAt: input.placementDecidedAt }
				: {}),
			...(input.spamReport !== undefined
				? { spamReport: input.spamReport }
				: {}),
			updatedAt: now,
		};

		await this.db
			.update(messageTable)
			.set(setValues)
			.where(eq(messageTable.messageId, messageId));
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

	async clearSpamReport(
		messageId: string,
	): ReturnType<IMessageRepository["clearSpamReport"]> {
		const now = Date.now();
		await this.db
			.update(messageTable)
			.set({ spamReport: null, updatedAt: now })
			.where(eq(messageTable.messageId, messageId));
		return this.get(messageId);
	}

	async setSearchText(messageId: string, text: string): Promise<void> {
		const now = Date.now();
		await this.db
			.insert(messageSearchTextTable)
			.values({ messageId, text, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: messageSearchTextTable.messageId,
				set: { text, updatedAt: now },
			});
	}

	async copySearchText(
		sourceMessageId: string,
		targetMessageId: string,
	): Promise<void> {
		const [source] = await this.db
			.select({ text: messageSearchTextTable.text })
			.from(messageSearchTextTable)
			.where(eq(messageSearchTextTable.messageId, sourceMessageId));
		if (!source) return;
		await this.setSearchText(targetMessageId, source.text);
	}

	async syncSearch(messageIds: string[]): Promise<void> {
		if (messageIds.length === 0) return;
		const listings = await this.db
			.select({ threadMessageId: threadMessageTable.threadMessageId })
			.from(threadMessageTable)
			.where(inList(threadMessageTable.messageId, messageIds));
		await this.search.sync(listings.map((row) => row.threadMessageId));
	}

	async listMissingSearchText(
		after: string,
		limit: number,
	): ReturnType<IMessageRepository["listMissingSearchText"]> {
		const rows = await this.db
			.select({
				messageId: messageTable.messageId,
				bodyStorageKey: messageTable.bodyStorageKey,
			})
			.from(messageTable)
			.leftJoin(
				messageSearchTextTable,
				eq(messageSearchTextTable.messageId, messageTable.messageId),
			)
			.where(
				and(
					gt(messageTable.messageId, after),
					isNotNull(messageTable.bodyStorageKey),
					isNull(messageSearchTextTable.messageId),
				),
			)
			.orderBy(asc(messageTable.messageId))
			.limit(limit);
		return rows.flatMap((row) =>
			row.bodyStorageKey
				? [{ messageId: row.messageId, bodyStorageKey: row.bodyStorageKey }]
				: [],
		);
	}

	async delete(messageId: string): Promise<void> {
		await this.deleteMany([messageId]);
	}

	async deleteIfPlacement(
		messageId: string,
		expected: PlacementPredicate,
	): Promise<boolean> {
		const placed = exists(
			this.db
				.select({ messageId: messageTable.messageId })
				.from(messageTable)
				.where(
					and(
						eq(messageTable.messageId, messageId),
						...placementTerms(expected),
					),
				),
		);
		const listings = await this.db
			.select({ threadMessageId: threadMessageTable.threadMessageId })
			.from(threadMessageTable)
			.where(eq(threadMessageTable.messageId, messageId));
		const subtree = deleteMessageSubtree(this.db, [messageId], placed);
		const [removed] = await this.batch([
			subtree.removed,
			this.db
				.delete(threadMessageTable)
				.where(and(eq(threadMessageTable.messageId, messageId), placed)),
			...subtree.statements,
		]);
		await this.search.sync(listings.map((row) => row.threadMessageId));
		await this.messageObjects.reclaim(removed);
		return removed.length > 0;
	}

	async deleteMany(messageIds: string[]): Promise<void> {
		if (messageIds.length === 0) return;
		const subtree = deleteMessageSubtree(this.db, messageIds);
		const [removed] = await this.batch([
			subtree.removed,
			...subtree.statements,
		]);
		await this.messageObjects.reclaim(removed);
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

	async listStrandedPlacements(
		mailboxIds: readonly string[],
		untouchedSince: number,
	): ReturnType<IMessageRepository["listStrandedPlacements"]> {
		if (mailboxIds.length === 0) return [];
		const ids = [...mailboxIds];
		const rows = await this.db
			.select()
			.from(messageTable)
			.where(
				and(
					lt(messageTable.updatedAt, untouchedSince),
					or(
						and(
							eq(messageTable.status, "moving"),
							inList(messageTable.originalMailboxId, ids),
							isNotNull(messageTable.originalUid),
						),
						and(
							eq(messageTable.status, "deleting"),
							inList(messageTable.mailboxId, ids),
						),
						and(
							eq(messageTable.status, "moving"),
							eq(messageTable.uid, 0),
							isNull(messageTable.originalUid),
							inList(messageTable.mailboxId, ids),
						),
					),
				),
			)
			.orderBy(asc(messageTable.updatedAt), asc(messageTable.messageId));
		return rows.map(toMessageItem);
	}

	async transitionPlacement(
		messageId: string,
		expected: PlacementPredicate,
		next: Parameters<IMessageRepository["transitionPlacement"]>[2],
	): ReturnType<IMessageRepository["transitionPlacement"]> {
		const setValues = {
			...(next.mailboxId !== undefined ? { mailboxId: next.mailboxId } : {}),
			...(next.uid !== undefined ? { uid: next.uid } : {}),
			...(next.status !== undefined ? { status: next.status } : {}),
			...(next.syncStatus !== undefined ? { syncStatus: next.syncStatus } : {}),
			...(next.abandonedMutation !== undefined
				? { abandonedMutation: next.abandonedMutation }
				: {}),
			...(next.originalMailboxId !== undefined
				? { originalMailboxId: next.originalMailboxId }
				: {}),
			...(next.originalUid !== undefined
				? { originalUid: next.originalUid }
				: {}),
			updatedAt: Date.now(),
		};

		const rows = await this.db
			.update(messageTable)
			.set(setValues)
			.where(
				and(eq(messageTable.messageId, messageId), ...placementTerms(expected)),
			)
			.returning();
		if (rows.length === 0) return undefined;
		return toMessageItem(rows[0]);
	}

	async repointIfPlacement(
		messageId: string,
		expected: PlacementPredicate,
		to: { mailboxId: string; uid: number; isDeleted: boolean },
	): Promise<boolean> {
		const now = Date.now();
		const landed = exists(
			this.db
				.select({ messageId: messageTable.messageId })
				.from(messageTable)
				.where(
					and(
						eq(messageTable.messageId, messageId),
						eq(messageTable.mailboxId, to.mailboxId),
						eq(messageTable.uid, to.uid),
					),
				),
		);
		const listings = await this.db
			.select({ threadMessageId: threadMessageTable.threadMessageId })
			.from(threadMessageTable)
			.where(eq(threadMessageTable.messageId, messageId));
		const [moved] = await this.batch([
			this.db
				.update(messageTable)
				.set({
					uid: to.uid,
					mailboxId: to.mailboxId,
					originalUid: null,
					status: "active",
					syncStatus: "synced",
					abandonedMutation: "none",
					updatedAt: now,
				})
				.where(
					and(
						eq(messageTable.messageId, messageId),
						...placementTerms(expected),
					),
				)
				.returning({ messageId: messageTable.messageId }),
			this.db
				.update(threadMessageTable)
				.set({
					mailboxId: to.mailboxId,
					uid: to.uid,
					isDeleted: to.isDeleted,
					updatedAt: now,
				})
				.where(and(eq(threadMessageTable.messageId, messageId), landed)),
		] as const);
		await this.search.sync(listings.map((row) => row.threadMessageId));
		return moved.length > 0;
	}

	async updateUid(
		messageId: string,
		newUid: number,
		newMailboxId: string,
	): ReturnType<IMessageRepository["updateUid"]> {
		// updateUid settles a move against confirmed IMAP state (the destination
		// mailbox and its COPYUID).
		//
		// `originalUid` goes with the settle. It exists to say the row's `uid`
		// was recorded under `originalMailboxId`, and that stops being true here;
		// left behind it makes the settled row indistinguishable from an
		// in-flight one whenever the destination's counter happens to hand back
		// the source's number, which on a young account is most of them (#1217).
		// `originalMailboxId` stays: Undo restores the message to it.
		const rows = await this.db
			.update(messageTable)
			.set({
				uid: newUid,
				mailboxId: newMailboxId,
				originalUid: null,
				status: "active",
				syncStatus: "synced",
				// The settle clears the epitaph as well as the pair. `syncStatus`
				// alone already gates every reader of it, so this is tidiness
				// rather than correctness — but a row that has just settled has
				// nothing it gave up on, and leaving a value there invites a
				// reader that forgets the gate.
				abandonedMutation: "none",
				updatedAt: Date.now(),
			})
			.where(eq(messageTable.messageId, messageId))
			.returning();
		if (rows.length === 0) {
			throw new NotFoundError(`Message not found: ${messageId}`);
		}
		return toMessageItem(rows[0]);
	}
}
