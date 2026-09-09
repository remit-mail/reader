import { randomUUID } from "node:crypto";
import type {
	CreateMailboxInput,
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
import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import shortUuid from "short-uuid";
import type { Db } from "../db.js";
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
import { threadMessageTable } from "../schema/thread-message.js";
import { runInTransaction } from "../tx.js";
import { deleteMessageSubtree } from "./message.js";

const base36Translator = shortUuid.createTranslator(
	shortUuid.constants.uuid25Base36,
);
const generateMailboxId = () => base36Translator.fromUUID(randomUUID());

type DB = Db<Record<string, unknown>>;

/**
 * Message subtrees removed per transaction by {@link MailboxRepo.deleteMailboxWithMail},
 * matching `SUBTREE_BATCH_SIZE` in the account purge. On SQLite each batch holds
 * the process's only write slot, so the bound is what keeps a large folder's
 * delete from parking every other writer behind it (D8).
 */
const MAIL_DELETE_BATCH_SIZE = 100;

/** Refuses a subtree intent from inside the transaction, so the throw is the rollback. */
class SubtreeContested extends Error {
	constructor() {
		super("mailbox subtree transition contested");
		this.name = "SubtreeContested";
	}
}

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
		cursorState: (row.cursorState as MailboxItem["cursorState"]) ?? undefined,
		specialUse: (row.specialUse as MailboxItem["specialUse"]) ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class MailboxRepo implements IMailboxRepository {
	constructor(private db: DB) {}

	async create(input: CreateMailboxInput): Promise<MailboxItem> {
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
			.returning();
		return rowToMailbox(row);
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
						inArray(mailboxTable.mailboxId, mailboxId),
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
		return runInTransaction(this.db, async (tx) => {
			const repo = new MailboxRepo(tx);
			const root = await repo
				.get(accountId, mailboxId)
				.catch((error: unknown) => {
					if (error instanceof NotFoundError) return null;
					throw error;
				});
			if (!root) return null;

			const subtree = [
				root,
				...(await repo.findByPathPrefix(
					accountId,
					root.fullPath,
					root.hierarchyDelimiter,
				)),
			];

			const written: MailboxItem[] = [];
			for (const row of subtree) {
				// The from-state predicate rides each UPDATE rather than a read
				// taken before them (D3). Read-then-check-then-write is safe on
				// SQLite only because `runInTransaction` serializes top-level
				// writes; under Postgres READ COMMITTED a single-row transition
				// committing in between is missed entirely.
				const [updated] = await tx
					.update(mailboxTable)
					.set(transitionSet(intent.to, intent.rowSet(row)))
					.where(
						and(
							eq(mailboxTable.accountId, accountId),
							eq(mailboxTable.mailboxId, row.mailboxId),
							inArray(mailboxTable.syncStatus, [...intent.from]),
						),
					)
					.returning();
				if (updated) written.push(rowToMailbox(updated));
			}

			// A subtree cannot be half-renamed: one row that moved out from under
			// this call refuses the whole intent, and the throw is what rolls the
			// rest back.
			if (written.length !== subtree.length) throw new SubtreeContested();
			return written;
		}).catch((error: unknown) => {
			if (error instanceof SubtreeContested) return null;
			throw error;
		});
	}

	async resolveAccountId(mailboxId: string): Promise<string | null> {
		const [row] = await this.db
			.select({ accountId: mailboxTable.accountId })
			.from(mailboxTable)
			.where(eq(mailboxTable.mailboxId, mailboxId));
		return row?.accountId ?? null;
	}

	async delete(accountId: string, mailboxId: string): Promise<void> {
		await this.db
			.delete(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					eq(mailboxTable.mailboxId, mailboxId),
				),
			);
	}

	async deleteMany(accountId: string, mailboxIds: string[]): Promise<void> {
		if (mailboxIds.length === 0) return;
		await this.db
			.delete(mailboxTable)
			.where(
				and(
					eq(mailboxTable.accountId, accountId),
					inArray(mailboxTable.mailboxId, mailboxIds),
				),
			);
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
		return this.create({ accountId, fullPath, ...defaults });
	}

	async findByPathPrefix(
		accountId: string,
		pathPrefix: string,
		delimiter = "/",
	): Promise<MailboxItem[]> {
		// A flat namespace nests nothing: with no delimiter the prefix is the
		// folder’s own path, which would match every sibling starting with it.
		if (delimiter.length === 0) return [];
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));
		const fullPrefix = `${pathPrefix}${delimiter}`;
		return rows
			.filter((r) => r.fullPath.startsWith(fullPrefix))
			.map(rowToMailbox);
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
		for (;;) {
			const rows = await this.db
				.select({ messageId: messageTable.messageId })
				.from(messageTable)
				.where(eq(messageTable.mailboxId, mailboxId))
				.limit(MAIL_DELETE_BATCH_SIZE);
			if (rows.length === 0) break;
			const messageIds = rows.map((row) => row.messageId);

			await runInTransaction(this.db, async (tx) => {
				// The primitive the rest of the codebase deletes mail with: nine
				// per-message child tables plus one `message.removed` outbox row
				// each, which is what clears the search index. A bespoke table
				// list would orphan those nine and leave deleted mail searchable.
				await deleteMessageSubtree(tx, messageIds);
				await tx
					.delete(threadMessageTable)
					.where(inArray(threadMessageTable.messageId, messageIds));
			});
		}

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
