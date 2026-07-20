import type {
	CreateThreadMessageInput,
	IThreadMessageRepository,
	ResultList,
	SearchOptions,
	ThreadMessageItem,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import shortUuid from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { fromMatch, subjectMatch } from "./thread-search-predicates.js";

// ─── ID generation (mirrors remit-electrodb-service/src/id.ts) ───────────────

const REMIT_NAMESPACE = "9e89694d-214b-4d9b-99f5-214b4d9b99f5";
const translator = shortUuid.createTranslator(shortUuid.constants.uuid25Base36);

const base36uuidv5 = (name: string): string =>
	translator.fromUUID(uuidv5(name, REMIT_NAMESPACE));

export const deriveThreadMessageId = (
	threadId: string,
	messageId: string,
): string => base36uuidv5(`threadmsg:${threadId}:${messageId}`);

// ─── Constants ────────────────────────────────────────────────────────────────

export const THREAD_SEARCH_MAX_LIMIT = 500;

/** Page size used when a list caller supplies no explicit limit. */
const DEFAULT_LIST_LIMIT = 100;

export const clampThreadSearchLimit = (limit?: number): number => {
	if (limit === undefined || !Number.isFinite(limit)) {
		return THREAD_SEARCH_MAX_LIMIT;
	}
	return Math.min(Math.max(Math.trunc(limit), 1), THREAD_SEARCH_MAX_LIMIT);
};

// ─── Cursor ──────────────────────────────────────────────────────────────────

type DateCursor = { s: number; id: string };
type AccountCursor = { id: string };

function encodeDateCursor(sentDate: number, threadMessageId: string): string {
	return Buffer.from(
		JSON.stringify({ s: sentDate, id: threadMessageId }),
	).toString("base64");
}

function decodeDateCursor(token: string): DateCursor | null {
	try {
		return JSON.parse(Buffer.from(token, "base64").toString()) as DateCursor;
	} catch {
		return null;
	}
}

function encodeAccountCursor(threadMessageId: string): string {
	return Buffer.from(JSON.stringify({ id: threadMessageId })).toString(
		"base64",
	);
}

function decodeAccountCursor(token: string): AccountCursor | null {
	try {
		return JSON.parse(Buffer.from(token, "base64").toString()) as AccountCursor;
	} catch {
		return null;
	}
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA = { threadMessage: threadMessageTable };
type Row = typeof threadMessageTable.$inferSelect;

// ─── Row mapping ─────────────────────────────────────────────────────────────

function toItem(row: Row): ThreadMessageItem {
	return {
		threadMessageId: row.threadMessageId,
		accountConfigId: row.accountConfigId,
		threadId: row.threadId,
		messageId: row.messageId,
		mailboxId: row.mailboxId,
		uid: row.uid,
		referenceOrder: row.referenceOrder,
		internalDate: row.internalDate,
		sentDate: row.sentDate,
		isRead: row.isRead,
		hasAttachment: row.hasAttachment,
		star: row.star as ThreadMessageItem["star"],
		hasStars: row.hasStars,
		isDeleted: row.isDeleted,
		category: row.category as ThreadMessageItem["category"],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(row.messageIdHeader !== null
			? { messageIdHeader: row.messageIdHeader }
			: {}),
		...(row.inReplyTo !== null ? { inReplyTo: row.inReplyTo } : {}),
		...(row.fromEmail !== null ? { fromEmail: row.fromEmail } : {}),
		...(row.fromName !== null ? { fromName: row.fromName } : {}),
		...(row.subject !== null ? { subject: row.subject } : {}),
		...(row.snippet !== null ? { snippet: row.snippet } : {}),
	};
}

// ─── Search predicates ────────────────────────────────────────────────────────

// The accent-/case-insensitive substring predicates are the one text-search
// seam that differs by dialect; they live in ./thread-search-predicates.ts
// (Postgres: unaccent + pg_trgm; SQLite: a folded LIKE fallback, RFC 036 D4).

// Translate SearchOptions into SQL conditions: subject/from/query as indexed
// text predicates, the rest as plain column equalities. A multi-word `query`
// matches rows where every token appears in the subject or the from fields
// (AND across tokens, OR across fields) — the same shape as the DynamoDB model.
function buildSearchConditions(search: SearchOptions): SQL[] {
	const conditions: SQL[] = [];

	if (search.subject) conditions.push(subjectMatch(search.subject));
	if (search.from) conditions.push(fromMatch(search.from));

	if (search.query) {
		const tokens = search.query.split(/\s+/).filter(Boolean);
		for (const token of tokens) {
			conditions.push(sql`(${subjectMatch(token)} or ${fromMatch(token)})`);
		}
	}

	if (search.unread !== undefined) {
		conditions.push(eq(threadMessageTable.isRead, !search.unread));
	}
	if (search.starred !== undefined) {
		conditions.push(eq(threadMessageTable.hasStars, search.starred));
	}
	if (search.attachments !== undefined) {
		conditions.push(eq(threadMessageTable.hasAttachment, search.attachments));
	}

	return conditions;
}

// Keyset cursor over (sent_date, thread_message_id). `desc` walks newest→oldest,
// `asc` oldest→newest; the id tiebreak keeps paging stable across equal dates.
function sentDateCursorCond(
	order: "asc" | "desc",
	cursor: DateCursor | null,
): SQL | undefined {
	if (!cursor) return undefined;
	const dateCmp =
		order === "desc"
			? lt(threadMessageTable.sentDate, cursor.s)
			: gt(threadMessageTable.sentDate, cursor.s);
	return or(
		dateCmp,
		and(
			eq(threadMessageTable.sentDate, cursor.s),
			gt(threadMessageTable.threadMessageId, cursor.id),
		),
	);
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class DrizzleThreadMessageRepository
	implements IThreadMessageRepository
{
	private db: Db<Record<string, unknown>>;

	constructor(connectionOrDb: string | Db<Record<string, unknown>>) {
		this.db =
			typeof connectionOrDb === "string"
				? drizzle(connectionOrDb, { schema: SCHEMA })
				: connectionOrDb;
	}

	async close(): Promise<void> {
		// The underlying driver differs by dialect: a pg Pool closes with `end()`,
		// a better-sqlite3 Database with `close()`. Feature-detect so a sqlite
		// handle never hits a missing `end()`.
		const client = (this.db as unknown as { $client?: unknown }).$client;
		if (client && typeof (client as { end?: unknown }).end === "function") {
			await (client as { end: () => Promise<void> }).end();
			return;
		}
		if (client && typeof (client as { close?: unknown }).close === "function") {
			(client as { close: () => void }).close();
		}
	}

	async create(input: CreateThreadMessageInput): Promise<ThreadMessageItem> {
		const now = Date.now();
		const threadMessageId = deriveThreadMessageId(
			input.threadId,
			input.messageId,
		);
		const row = {
			threadMessageId,
			accountConfigId: input.accountConfigId,
			threadId: input.threadId,
			messageId: input.messageId,
			mailboxId: input.mailboxId,
			uid: input.uid,
			referenceOrder: input.referenceOrder,
			internalDate: input.internalDate,
			sentDate: input.sentDate,
			isRead: input.isRead,
			hasAttachment: input.hasAttachment,
			star: input.star ?? "none",
			hasStars: input.hasStars,
			isDeleted: input.isDeleted,
			category: input.category ?? "uncategorized",
			messageIdHeader: input.messageIdHeader ?? null,
			inReplyTo: input.inReplyTo ?? null,
			fromEmail: input.fromEmail ?? null,
			fromName: input.fromName ?? null,
			subject: input.subject ?? null,
			snippet: input.snippet ?? null,
			createdAt: now,
			updatedAt: now,
		};
		const [inserted] = await this.db
			.insert(threadMessageTable)
			.values(row)
			.onConflictDoNothing()
			.returning();
		if (inserted) return toItem(inserted);

		const [existing] = await this.db
			.select()
			.from(threadMessageTable)
			.where(eq(threadMessageTable.threadMessageId, threadMessageId));
		if (!existing) throw new NotFoundError("ThreadMessage not found");
		return toItem(existing);
	}

	async get(
		accountConfigId: string,
		threadMessageId: string,
	): Promise<ThreadMessageItem>;
	async get(
		accountConfigId: string,
		threadMessageIds: string[],
	): Promise<ThreadMessageItem[]>;
	async get(
		accountConfigId: string,
		threadMessageId: string | string[],
	): Promise<ThreadMessageItem | ThreadMessageItem[]> {
		if (Array.isArray(threadMessageId)) {
			if (threadMessageId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(threadMessageTable)
				.where(
					and(
						eq(threadMessageTable.accountConfigId, accountConfigId),
						inArray(threadMessageTable.threadMessageId, threadMessageId),
					),
				);
			return rows.map(toItem);
		}

		const [row] = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.threadMessageId, threadMessageId),
				),
			);
		if (!row) throw new NotFoundError("ThreadMessage not found");
		return toItem(row);
	}

	async update(
		accountConfigId: string,
		threadMessageId: string,
		input: UpdateThreadMessageInput,
		_options?: {
			composites?: {
				sentDate?: number;
				mailboxId?: string;
				isRead?: boolean;
				isDeleted?: boolean;
				hasStars?: boolean;
				hasAttachment?: boolean;
			};
		},
	): Promise<ThreadMessageItem> {
		const now = Date.now();
		const set: Partial<Row> = { updatedAt: now };
		if (input.mailboxId !== undefined) set.mailboxId = input.mailboxId;
		if (input.uid !== undefined) set.uid = input.uid;
		if (input.isRead !== undefined) set.isRead = input.isRead;
		if (input.isDeleted !== undefined) set.isDeleted = input.isDeleted;
		if (input.hasAttachment !== undefined)
			set.hasAttachment = input.hasAttachment;
		if (input.hasStars !== undefined) set.hasStars = input.hasStars;
		if (input.star !== undefined) set.star = input.star;
		if (input.category !== undefined) set.category = input.category;
		if (input.subject !== undefined) set.subject = input.subject;
		if (input.fromEmail !== undefined) set.fromEmail = input.fromEmail;
		if (input.fromName !== undefined) set.fromName = input.fromName;
		if (input.snippet !== undefined) set.snippet = input.snippet;
		if (input.sentDate !== undefined) set.sentDate = input.sentDate;
		if (input.internalDate !== undefined) set.internalDate = input.internalDate;
		if (input.messageIdHeader !== undefined)
			set.messageIdHeader = input.messageIdHeader;
		if (input.inReplyTo !== undefined) set.inReplyTo = input.inReplyTo;
		if (input.referenceOrder !== undefined)
			set.referenceOrder = input.referenceOrder;

		const [row] = await this.db
			.update(threadMessageTable)
			.set(set)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.threadMessageId, threadMessageId),
				),
			)
			.returning();
		if (!row) throw new NotFoundError("ThreadMessage not found");
		return toItem(row);
	}

	async delete(
		accountConfigId: string,
		threadMessageId: string,
	): Promise<void> {
		await this.db
			.delete(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.threadMessageId, threadMessageId),
				),
			);
	}

	async deleteMany(
		keys: Array<{ accountConfigId: string; threadMessageId: string }>,
	): Promise<void> {
		if (keys.length === 0) return;
		const accountConfigId = keys[0].accountConfigId;
		const ids = keys.map((k) => k.threadMessageId);
		await this.db
			.delete(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					inArray(threadMessageTable.threadMessageId, ids),
				),
			);
	}

	async listByAccount(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<ThreadMessageItem>> {
		const cursor = options?.continuationToken
			? decodeAccountCursor(options.continuationToken)
			: null;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					cursor
						? gt(threadMessageTable.threadMessageId, cursor.id)
						: undefined,
				),
			)
			.orderBy(asc(threadMessageTable.threadMessageId))
			.limit(options?.limit ?? 100);

		const lastRow = rows[rows.length - 1];
		const hasMore =
			options?.limit !== undefined && rows.length === options.limit;
		return {
			items: rows.map(toItem),
			continuationToken:
				hasMore && lastRow
					? encodeAccountCursor(lastRow.threadMessageId)
					: undefined,
		};
	}

	async listByDate(
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			inboxMailboxIds?: Set<string>;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "desc";
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const cursorCond = cursor
			? order === "desc"
				? or(
						lt(threadMessageTable.sentDate, cursor.s),
						and(
							eq(threadMessageTable.sentDate, cursor.s),
							gt(threadMessageTable.threadMessageId, cursor.id),
						),
					)
				: or(
						gt(threadMessageTable.sentDate, cursor.s),
						and(
							eq(threadMessageTable.sentDate, cursor.s),
							gt(threadMessageTable.threadMessageId, cursor.id),
						),
					)
			: undefined;

		const mailboxCond = options?.inboxMailboxIds?.size
			? inArray(threadMessageTable.mailboxId, [...options.inboxMailboxIds])
			: undefined;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					mailboxCond,
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					cursorCond,
				),
			)
			.orderBy(
				order === "desc"
					? desc(threadMessageTable.sentDate)
					: asc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(options?.limit ?? 100);

		const lastRow = rows[rows.length - 1];
		const hasMore =
			options?.limit !== undefined && rows.length === options.limit;
		return {
			items: rows.map(toItem),
			continuationToken:
				hasMore && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	/**
	 * Cross-mailbox search for the unified listing's search mode. Same predicate
	 * builder and keyset cursor as `searchByMailboxWindow`, with the mailbox
	 * equality swapped for the caller's scope set. Matching runs in SQL over the
	 * whole scope, so a short page means the matches are exhausted.
	 */
	async searchByDate(
		accountConfigId: string,
		search: SearchOptions,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			mailboxIds?: Set<string>;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "desc";
		const limit = clampThreadSearchLimit(options?.limit);
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const mailboxCond = options?.mailboxIds?.size
			? inArray(threadMessageTable.mailboxId, [...options.mailboxIds])
			: undefined;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					mailboxCond,
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					...buildSearchConditions(search),
					sentDateCursorCond(order, cursor),
				),
			)
			.orderBy(
				order === "desc"
					? desc(threadMessageTable.sentDate)
					: asc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(limit);

		const lastRow = rows[rows.length - 1];
		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	async listByStarred(
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			mailboxIds?: Set<string>;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "desc";
		// Default before the has-more check, or an absent limit silently truncates
		// at the implicit cap with no continuation token.
		const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const mailboxCond = options?.mailboxIds?.size
			? inArray(threadMessageTable.mailboxId, [...options.mailboxIds])
			: undefined;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.hasStars, true),
					mailboxCond,
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					sentDateCursorCond(order, cursor),
				),
			)
			.orderBy(
				order === "desc"
					? desc(threadMessageTable.sentDate)
					: asc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(limit);

		const lastRow = rows[rows.length - 1];
		const hasMore = rows.length === limit;
		return {
			items: rows.map(toItem),
			continuationToken:
				hasMore && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	async listByThread(
		threadId: string,
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "asc";
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const cursorCond = cursor
			? order === "asc"
				? or(
						gt(threadMessageTable.sentDate, cursor.s),
						and(
							eq(threadMessageTable.sentDate, cursor.s),
							gt(threadMessageTable.threadMessageId, cursor.id),
						),
					)
				: or(
						lt(threadMessageTable.sentDate, cursor.s),
						and(
							eq(threadMessageTable.sentDate, cursor.s),
							gt(threadMessageTable.threadMessageId, cursor.id),
						),
					)
			: undefined;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.threadId, threadId),
					eq(threadMessageTable.accountConfigId, accountConfigId),
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					cursorCond,
				),
			)
			.orderBy(
				order === "asc"
					? asc(threadMessageTable.sentDate)
					: desc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(options?.limit ?? 100);

		const lastRow = rows[rows.length - 1];
		const hasMore =
			options?.limit !== undefined && rows.length === options.limit;
		return {
			items: rows.map(toItem),
			continuationToken:
				hasMore && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	async findByMessageId(
		accountConfigId: string,
		messageId: string,
	): Promise<ThreadMessageItem | null> {
		const [row] = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.messageId, messageId),
				),
			)
			.limit(1);
		return row ? toItem(row) : null;
	}

	async findAllByMessageId(
		accountConfigId: string,
		messageId: string,
	): Promise<ThreadMessageItem[]> {
		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.messageId, messageId),
				),
			);
		return rows.map(toItem);
	}

	async getByMessageId(
		accountConfigId: string,
		messageId: string,
	): Promise<ThreadMessageItem> {
		const item = await this.findByMessageId(accountConfigId, messageId);
		if (!item) throw new NotFoundError("ThreadMessage not found");
		return item;
	}

	async listByMailbox(
		accountConfigId: string,
		mailboxId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			attributes?: string[];
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "desc";
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.mailboxId, mailboxId),
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					sentDateCursorCond(order, cursor),
				),
			)
			.orderBy(
				order === "desc"
					? desc(threadMessageTable.sentDate)
					: asc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(options?.limit ?? 100);

		const lastRow = rows[rows.length - 1];
		const hasMore =
			options?.limit !== undefined && rows.length === options.limit;
		return {
			items: rows.map(toItem),
			continuationToken:
				hasMore && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	async countByThread(
		accountConfigId: string,
		threadId: string,
	): Promise<number> {
		const [{ count }] = await this.db
			.select({ count: sql<number>`cast(count(*) as int)` })
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.threadId, threadId),
				),
			);
		return count;
	}

	async searchByMailbox(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			order?: "asc" | "desc";
			count?: number;
			continuationToken?: string;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "desc";
		const limit = options?.count ?? 100;
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.mailboxId, mailboxId),
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					...buildSearchConditions(search),
					sentDateCursorCond(order, cursor),
				),
			)
			.orderBy(
				order === "desc"
					? desc(threadMessageTable.sentDate)
					: asc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(limit);

		const lastRow = rows[rows.length - 1];
		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	/**
	 * Mailbox search for `searchThreads`. Matching (subject / from / query and
	 * the boolean filters) runs in SQL over the whole mailbox via the trigram
	 * indexes, ordered by sent_date with an id tiebreak. `limit` is a page size
	 * over MATCHES (clamped to THREAD_SEARCH_MAX_LIMIT); the DynamoDB name is
	 * kept for interface parity, but there is no recent-window read bound —
	 * Postgres indexes the text, so a match anywhere in the mailbox is reachable.
	 *
	 * Cursor: the last returned row `(sentDate, threadMessageId)`. A full page
	 * yields a cursor so callers can resume.
	 */
	async searchByMailboxWindow(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			attributes?: string[];
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const order = options?.order ?? "desc";
		const limit = clampThreadSearchLimit(options?.limit);
		const cursor = options?.continuationToken
			? decodeDateCursor(options.continuationToken)
			: null;

		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.mailboxId, mailboxId),
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					...buildSearchConditions(search),
					sentDateCursorCond(order, cursor),
				),
			)
			.orderBy(
				order === "desc"
					? desc(threadMessageTable.sentDate)
					: asc(threadMessageTable.sentDate),
				asc(threadMessageTable.threadMessageId),
			)
			.limit(limit);

		const lastRow = rows[rows.length - 1];
		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && lastRow
					? encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	/**
	 * COUNT of matches over the SAME predicate as `searchByMailboxWindow`, capped
	 * at the same clamped limit so `count` never exceeds one page — count equals
	 * `items.length` whenever both are issued with the same limit.
	 */
	async countByMailbox(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			limit?: number;
			excludeDeleted?: boolean;
			order?: "asc" | "desc";
		},
	): Promise<number> {
		const cap = clampThreadSearchLimit(options?.limit);
		const [{ count }] = await this.db
			.select({ count: sql<number>`cast(count(*) as int)` })
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.mailboxId, mailboxId),
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					...buildSearchConditions(search),
				),
			);
		return Math.min(count, cap);
	}

	async listAllByAccount(
		accountConfigId: string,
	): Promise<ThreadMessageItem[]> {
		const rows = await this.db
			.select()
			.from(threadMessageTable)
			.where(eq(threadMessageTable.accountConfigId, accountConfigId));
		return rows.map(toItem);
	}

	async deleteAllByAccount(accountConfigId: string): Promise<number> {
		const result = await this.db
			.delete(threadMessageTable)
			.where(eq(threadMessageTable.accountConfigId, accountConfigId))
			.returning({ id: threadMessageTable.threadMessageId });
		return result.length;
	}
}
