import { randomUUID } from "node:crypto";
import type {
	CreateMailboxInput,
	CreateMailboxResult,
	IMailboxRepository,
	MailboxItem,
	MailboxStatePredicate,
	MailboxSubtreeTransitionIntent,
	MailboxTransitionIntent,
	MailboxTransitionWrite,
	ResultList,
	UpdateMailboxInput,
} from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import {
	and,
	asc,
	eq,
	exists,
	gt,
	inArray,
	isNull,
	not,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import shortUuid from "short-uuid";
import type { WriteBatch } from "../batch.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import { NotFoundError } from "../error.js";
import { decodeToken, resultList } from "../pagination.js";
import {
	mailboxAttributeTable,
	mailboxFlagTable,
	mailboxSpecialUseTable,
	mailboxTable,
} from "../schema/i4-mailbox.js";
import { mailboxLockTable } from "../schema/i4-mailbox-lock.js";
import { messageFlagPushTable } from "../schema/i4-message-flag-push.js";
import { messagePlacementMoveTable } from "../schema/i4-message-placement-move.js";
import { messageTable } from "../schema/message-data.js";
import { syncWarningTable } from "../schema/sync-warning.js";
import { inList } from "./in-list.js";
import type { DrizzleMessageRepository } from "./message.js";

const base36Translator = shortUuid.createTranslator(
	shortUuid.constants.uuid25Base36,
);
const generateMailboxId = () => base36Translator.fromUUID(randomUUID());

type DB = RepositoryDb<Record<string, unknown>>;

/**
 * Message subtrees removed per batch by {@link MailboxRepo.deleteMailboxWithMail},
 * matching `SUBTREE_BATCH_SIZE` in the account purge. On SQLite each batch holds
 * the file's write lock, so the bound is what keeps a large folder's delete from
 * parking every other writer behind it (D8).
 */

/**
 * The folders under `path`. A flat namespace nests nothing: with no delimiter
 * the prefix is the folder's own path, which would match every sibling
 * starting with it. Lengths are SQL's, so a path is measured the way `substr`
 * cuts it, in characters rather than UTF-16 units.
 */
const descendantOf = (path: string, delimiter: string): SQL => {
	if (delimiter.length === 0) return sql`0`;
	const prefix = `${path}${delimiter}`;
	return sql`substr(${mailboxTable.fullPath}, 1, length(${prefix})) = ${prefix}`;
};

/** The WHERE terms of a folder-state transition (folder-rename-and-delete.md D3). */
const stateTerms = (expected: MailboxStatePredicate): SQL[] => {
	const terms: SQL[] = [
		inArray(mailboxTable.syncStatus, [...expected.from]),
	] as SQL[];
	if (expected.wherePendingPath === undefined) return terms;
	terms.push(
		expected.wherePendingPath === null
			? isNull(mailboxTable.pendingPath)
			: eq(mailboxTable.pendingPath, expected.wherePendingPath),
	);
	return terms;
};

/**
 * A rename target only means something while a rename is outstanding or has
 * just failed, so the two states that cannot carry one drop it here rather than
 * relying on every caller to remember. That is what makes the invariant — a
 * non-null `pendingPath` only under `pending` or `failed` — hold by
 * construction: this is the only writer of either field, and `synced` with a
 * target on it is the seventh combination the design calls unreachable.
 */
const KEEPS_A_RENAME_TARGET: readonly MailboxItem["syncStatus"][] = [
	"pending",
	"failed",
];

const transitionSet = (
	to: MailboxItem["syncStatus"],
	write: MailboxTransitionWrite | undefined,
): Partial<typeof mailboxTable.$inferInsert> => ({
	syncStatus: to,
	...(write?.fullPath !== undefined ? { fullPath: write.fullPath } : {}),
	...(KEEPS_A_RENAME_TARGET.includes(to)
		? write?.pendingPath !== undefined
			? { pendingPath: write.pendingPath }
			: {}
		: { pendingPath: null }),
	syncFailureReason: to === "failed" ? (write?.syncFailureReason ?? "") : "",
	updatedAt: Date.now(),
});

export function rowToMailbox(
	row: typeof mailboxTable.$inferSelect,
): MailboxItem {
	return {
		mailboxId: row.mailboxId,
		accountId: row.accountId,
		namespaceType: row.namespaceType as MailboxItem["namespaceType"],
		namespacePrefix: row.namespacePrefix,
		hierarchyDelimiter: row.hierarchyDelimiter,
		fullPath: row.fullPath,
		uidValidity: row.uidValidity,
		uidNext: row.uidNext,
		highestModseq: row.highestModseq,
		messageCount: row.messageCount,
		unseenCount: row.unseenCount,
		deletedCount: row.deletedCount,
		totalSize: row.totalSize,
		lastSyncUid: row.lastSyncUid,
		highWaterMarkUid: row.highWaterMarkUid,
		lastMessageSyncAt: row.lastMessageSyncAt,
		initialSyncCompletedAt: row.initialSyncCompletedAt ?? undefined,
		parentMailboxId: row.parentMailboxId,
		syncStatus: row.syncStatus as MailboxItem["syncStatus"],
		...(row.pendingPath !== null ? { pendingPath: row.pendingPath } : {}),
		syncFailureReason: row.syncFailureReason,
		cursorState: (row.cursorState as MailboxItem["cursorState"]) ?? undefined,
		specialUse: (row.specialUse as MailboxItem["specialUse"]) ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class MailboxRepo implements IMailboxRepository {
	private readonly db: DB;
	private readonly batch: WriteBatch;

	constructor(
		store: SqliteStore<Record<string, unknown>>,
		private messages: Pick<DrizzleMessageRepository, "deleteMany">,
	) {
		this.db = store.db;
		this.batch = store.batch;
	}

	async create(input: CreateMailboxInput): Promise<CreateMailboxResult> {
		const now = Date.now();
		const [row] = await this.db
			.insert(mailboxTable)
			.values({
				mailboxId: generateMailboxId(),
				accountId: input.accountId,
				namespaceType: input.namespaceType ?? "personal",
				namespacePrefix: input.namespacePrefix,
				hierarchyDelimiter: input.hierarchyDelimiter,
				fullPath: input.fullPath,
				uidValidity: input.uidValidity,
				uidNext: input.uidNext,
				highestModseq: input.highestModseq,
				messageCount: input.messageCount,
				unseenCount: input.unseenCount,
				deletedCount: input.deletedCount,
				totalSize: input.totalSize,
				lastSyncUid: input.lastSyncUid,
				highWaterMarkUid: input.highWaterMarkUid,
				lastMessageSyncAt: input.lastMessageSyncAt,
				initialSyncCompletedAt: input.initialSyncCompletedAt,
				parentMailboxId: input.parentMailboxId ?? "",
				// Total per D1: an insert that names no state is a folder the
				// server just told us about, and a folder the server told us
				// about is confirmed.
				syncStatus: input.syncStatus ?? "synced",
				cursorState: input.cursorState ?? MailboxCursorState.normal,
				specialUse: input.specialUse ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing({
				target: [mailboxTable.accountId, mailboxTable.fullPath],
			})
			.returning();
		if (!row) return { outcome: "PathTaken" };
		return { outcome: "Created", mailbox: rowToMailbox(row) };
	}

	async get(accountId: string, mailboxId: string): Promise<MailboxItem>;
	async get(accountId: string, mailboxIds: string[]): Promise<MailboxItem[]>;
	async get(
		accountId: string,
		mailboxId: string | string[],
	): Promise<MailboxItem | MailboxItem[]> {
		if (Array.isArray(mailboxId)) {
			if (mailboxId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(mailboxTable)
				.where(
					and(
						eq(mailboxTable.accountId, accountId),
						inList(mailboxTable.mailboxId, mailboxId),
					),
				);
			return rows.map(rowToMailbox);
		}
		const [row] = await this.db
			.select()
			.from(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.mailboxId, mailboxId),
				),
			);
		if (!row) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);
		return rowToMailbox(row);
	}

	async update(
		accountId: string,
		mailboxId: string,
		input: UpdateMailboxInput,
		remove?: (keyof UpdateMailboxInput)[],
	): Promise<MailboxItem> {
		const now = Date.now();
		const updates: Partial<typeof mailboxTable.$inferInsert> = {
			updatedAt: now,
		};

		if (input.namespaceType !== undefined)
			updates.namespaceType = input.namespaceType;
		if (input.namespacePrefix !== undefined)
			updates.namespacePrefix = input.namespacePrefix;
		if (input.hierarchyDelimiter !== undefined)
			updates.hierarchyDelimiter = input.hierarchyDelimiter;
		if (input.fullPath !== undefined) updates.fullPath = input.fullPath;
		if (input.uidValidity !== undefined)
			updates.uidValidity = input.uidValidity;
		if (input.uidNext !== undefined) updates.uidNext = input.uidNext;
		if (input.highestModseq !== undefined)
			updates.highestModseq = input.highestModseq;
		if (input.messageCount !== undefined)
			updates.messageCount = input.messageCount;
		if (input.unseenCount !== undefined)
			updates.unseenCount = input.unseenCount;
		if (input.deletedCount !== undefined)
			updates.deletedCount = input.deletedCount;
		if (input.totalSize !== undefined) updates.totalSize = input.totalSize;
		if (input.lastSyncUid !== undefined)
			updates.lastSyncUid = input.lastSyncUid;
		if (input.highWaterMarkUid !== undefined)
			updates.highWaterMarkUid = input.highWaterMarkUid;
		if (input.lastMessageSyncAt !== undefined)
			updates.lastMessageSyncAt = input.lastMessageSyncAt;
		if (input.initialSyncCompletedAt !== undefined)
			updates.initialSyncCompletedAt = input.initialSyncCompletedAt;
		if (input.parentMailboxId !== undefined)
			updates.parentMailboxId = input.parentMailboxId;
		if (input.cursorState !== undefined)
			updates.cursorState = input.cursorState;
		if (input.specialUse !== undefined) updates.specialUse = input.specialUse;

		if (remove) {
			for (const field of remove) {
				if (field === "specialUse") updates.specialUse = null;
			}
		}

		const [row] = await this.db
			.update(mailboxTable)
			.set(updates)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.mailboxId, mailboxId),
				),
			)
			.returning();
		if (!row) throw new NotFoundError(`Mailbox not found: ${mailboxId}`);
		return rowToMailbox(row);
	}

	async transition(
		accountId: string,
		mailboxId: string,
		intent: MailboxTransitionIntent,
	): Promise<MailboxItem | null> {
		const [row] = await this.db
			.update(mailboxTable)
			.set(transitionSet(intent.to, intent.set))
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.mailboxId, mailboxId),
					...stateTerms(intent),
				),
			)
			.returning();
		return row ? rowToMailbox(row) : null;
	}

	async transitionSubtree(
		accountId: string,
		mailboxId: string,
		intent: MailboxSubtreeTransitionIntent,
	): Promise<MailboxItem[] | null> {
		const root = await this.get(accountId, mailboxId).catch(
			(error: unknown) => {
				if (error instanceof NotFoundError) return null;
				throw error;
			},
		);
		if (!root) return null;

		const inSubtree = and(
			eq(mailboxTable.accountId, accountId),
			or(
				eq(mailboxTable.mailboxId, root.mailboxId),
				descendantOf(root.fullPath, root.hierarchyDelimiter),
			),
		);

		// One statement, so a subtree is never half-renamed: every row takes its
		// rebased target together, and only while none of them is outside a
		// from-state. Lengths are SQL's, counted the way `substr` counts.
		const written = await this.db
			.update(mailboxTable)
			.set({
				...transitionSet(intent.to, undefined),
				pendingPath: sql`${intent.newPath} || substr(${mailboxTable.fullPath}, length(${root.fullPath}) + 1)`,
			})
			.where(
				and(
					inSubtree,
					not(
						exists(
							this.db
								.select({ mailboxId: mailboxTable.mailboxId })
								.from(mailboxTable)
								.where(
									and(
										inSubtree,
										notInArray(mailboxTable.syncStatus, [...intent.from]),
									),
								),
						),
					),
				),
			)
			.returning();
		if (written.length === 0) return null;
		return [
			...written.filter((row) => row.mailboxId === root.mailboxId),
			...written.filter((row) => row.mailboxId !== root.mailboxId),
		].map(rowToMailbox);
	}

	async resolveAccountId(mailboxId: string): Promise<string | null> {
		const [row] = await this.db
			.select({ accountId: mailboxTable.accountId })
			.from(mailboxTable)
			.where(eq(mailboxTable.mailboxId, mailboxId));
		return row?.accountId ?? null;
	}

	async delete(accountId: string, mailboxId: string): Promise<void> {
		await this.deleteMany(accountId, [mailboxId]);
	}

	async deleteMany(accountId: string, mailboxIds: string[]): Promise<void> {
		if (mailboxIds.length === 0) return;
		await this.batch([
			this.db
				.delete(syncWarningTable)
				.where(
					and(
						eq(syncWarningTable.accountId, accountId),
						inList(syncWarningTable.mailboxId, mailboxIds),
					),
				),
			this.db
				.delete(mailboxTable)
				.where(
					and(
						eq(mailboxTable.accountId, accountId),
						inList(mailboxTable.mailboxId, mailboxIds),
					),
				),
		]);
	}

	async listByAccount(
		accountId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<MailboxItem>> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? {
					createdAt: cursor.createdAt as number,
					mailboxId: cursor.mailboxId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					after
						? or(
								gt(mailboxTable.createdAt, after.createdAt),
								and(
									eq(mailboxTable.createdAt, after.createdAt),
									gt(mailboxTable.mailboxId, after.mailboxId),
								),
							)
						: undefined,
				),
			)
			.orderBy(asc(mailboxTable.createdAt), asc(mailboxTable.mailboxId))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToMailbox);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? { createdAt: lastItem.createdAt, mailboxId: lastItem.mailboxId }
				: undefined,
		);
	}

	async listAllByAccount(accountId: string): Promise<MailboxItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));
		return rows.map(rowToMailbox);
	}

	async findByPath(
		accountId: string,
		fullPath: string,
	): Promise<MailboxItem | null> {
		const [row] = await this.db
			.select()
			.from(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.fullPath, fullPath),
				),
			);
		return row ? rowToMailbox(row) : null;
	}

	async getOrCreateByPath(
		accountId: string,
		fullPath: string,
		defaults: Omit<CreateMailboxInput, "accountId" | "fullPath">,
	): Promise<MailboxItem> {
		const existing = await this.findByPath(accountId, fullPath);
		if (existing) return existing;
		const created = await this.create({ accountId, fullPath, ...defaults });
		if (created.outcome === "Created") return created.mailbox;
		const winner = await this.findByPath(accountId, fullPath);
		if (!winner) {
			throw new NotFoundError(`Mailbox not found at path: ${fullPath}`);
		}
		return winner;
	}

	async findByPathPrefix(
		accountId: string,
		pathPrefix: string,
		delimiter = "/",
	): Promise<MailboxItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					descendantOf(pathPrefix, delimiter),
				),
			);
		return rows.map(rowToMailbox);
	}

	async findBySyncStatus(
		accountId: string,
		syncStatus: NonNullable<MailboxItem["syncStatus"]>,
	): Promise<MailboxItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.syncStatus, syncStatus),
				),
			);
		return rows.map(rowToMailbox);
	}

	async deleteMailboxWithMail(
		accountId: string,
		mailboxId: string,
	): Promise<void> {
		// Tenant scope, and the re-entry guard in the same read: a redelivery that
		// arrives after the final commit finds no row and has nothing left to do,
		// exactly as `delete` no-ops. Every removal below keys on `mailboxId`
		// alone, so this is what stops a foreign accountId reaching them.
		const [owned] = await this.db
			.select({ mailboxId: mailboxTable.mailboxId })
			.from(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.mailboxId, mailboxId),
				),
			);
		if (!owned) return;

		// Ordered, batched and resumable rather than one transaction (D8). The
		// caller keeps the row `deleting` until the last commit, so an interrupted
		// run re-enters here and continues against whatever is left.
		const rows = await this.db
			.select({ messageId: messageTable.messageId })
			.from(messageTable)
			.where(eq(messageTable.mailboxId, mailboxId));
		await this.messages.deleteMany(rows.map((row) => row.messageId));

		await this.db
			.delete(mailboxSpecialUseTable)
			.where(eq(mailboxSpecialUseTable.mailboxId, mailboxId));
		await this.db
			.delete(mailboxAttributeTable)
			.where(eq(mailboxAttributeTable.mailboxId, mailboxId));
		await this.db
			.delete(mailboxFlagTable)
			.where(eq(mailboxFlagTable.mailboxId, mailboxId));
		await this.db
			.delete(mailboxLockTable)
			.where(eq(mailboxLockTable.mailboxId, mailboxId));
		await this.db
			.delete(messageFlagPushTable)
			.where(eq(messageFlagPushTable.mailboxId, mailboxId));
		await this.db
			.delete(messagePlacementMoveTable)
			.where(
				or(
					eq(messagePlacementMoveTable.sourceMailboxId, mailboxId),
					eq(messagePlacementMoveTable.destinationMailboxId, mailboxId),
				),
			);

		// `filter` also carries a mailboxId and is deliberately not in that list:
		// D16 refuses the delete while any filter or role appointment is bound, so
		// there is nothing to unbind, and deleting a user's filters as a side
		// effect of a folder delete is the outcome the design rules out.

		await this.delete(accountId, mailboxId);
	}
}
