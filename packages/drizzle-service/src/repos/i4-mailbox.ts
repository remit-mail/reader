import { randomUUID } from "node:crypto";
import type {
	CreateMailboxInput,
	IMailboxRepository,
	MailboxItem,
	ResultList,
	UpdateMailboxInput,
} from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import shortUuid from "short-uuid";
import { NotFoundError } from "../error.js";
import { decodeToken, resultList } from "../pagination.js";
import { mailboxTable } from "../schema/i4-mailbox.js";

const base36Translator = shortUuid.createTranslator(
	shortUuid.constants.uuid25Base36,
);
const generateMailboxId = () => base36Translator.fromUUID(randomUUID());

type DB = NodePgDatabase<Record<string, unknown>>;

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
		syncStatus: (row.syncStatus as MailboxItem["syncStatus"]) ?? undefined,
		cursorState: (row.cursorState as MailboxItem["cursorState"]) ?? undefined,
		oldPath: row.oldPath ?? undefined,
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
				syncStatus: input.syncStatus,
				cursorState: input.cursorState ?? MailboxCursorState.normal,
				oldPath: input.oldPath,
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
		if (input.syncStatus !== undefined) updates.syncStatus = input.syncStatus;
		if (input.cursorState !== undefined)
			updates.cursorState = input.cursorState;
		if (input.oldPath !== undefined) updates.oldPath = input.oldPath;
		if (input.specialUse !== undefined) updates.specialUse = input.specialUse;

		if (remove) {
			for (const field of remove) {
				if (field === "syncStatus") updates.syncStatus = null;
				if (field === "oldPath") updates.oldPath = null;
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

	async renameChildPaths(
		accountId: string,
		oldPath: string,
		newPath: string,
		delimiter = "/",
	): Promise<void> {
		const children = await this.findByPathPrefix(accountId, oldPath, delimiter);
		for (const child of children) {
			const newChildPath = child.fullPath.replace(oldPath, newPath);
			await this.update(accountId, child.mailboxId, { fullPath: newChildPath });
		}
	}
}
