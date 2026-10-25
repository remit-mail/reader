import type {
	CreateThreadMessageInput,
	IThreadMessageRepository,
	ResultList,
	SearchOptions,
	ThreadMessageFieldTerm,
	ThreadMessageItem,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import {
	and,
	asc,
	desc,
	eq,
	exists,
	gt,
	inArray,
	lt,
	not,
	or,
	type SQL,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import { runBatch } from "../batch.js";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { deterministicBase36Id } from "../id.js";
import { decodeToken } from "../pagination.js";
import { addressTable } from "../schema/i4-address.js";
import { threadMessageTable } from "../schema/thread-message.js";
import type {
	SearchIndex,
	SearchPosition,
} from "../search/thread-message-search.js";
import { inList } from "./in-list.js";
import {
	bodyMatch,
	fromMatch,
	isNarrowableTerm,
	listIdMatch,
	senderMatchRank,
	subjectMatch,
} from "./thread-search-predicates.js";

export const deriveThreadMessageId = (
	threadId: string,
	messageId: string,
): string => deterministicBase36Id(`threadmsg:${threadId}:${messageId}`);

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
type RankedDateCursor = { v: 2; r: number; s: number; id: string };
type SearchCursor = RankedDateCursor | (DateCursor & { v: 1 });

function encodeRankedDateCursor(
	rank: number,
	sentDate: number,
	threadMessageId: string,
): string {
	return Buffer.from(
		JSON.stringify({ v: 2, r: rank, s: sentDate, id: threadMessageId }),
	).toString("base64");
}

function decodeSearchCursor(token: string): SearchCursor {
	const decoded = decodeToken(token, "base64");
	if (decoded.v === undefined) {
		return { v: 1, ...decodeDateCursor(token) };
	}
	if (
		decoded.v !== 2 ||
		typeof decoded.r !== "number" ||
		typeof decoded.s !== "number" ||
		typeof decoded.id !== "string"
	) {
		throw new BadRequestError("Invalid continuationToken");
	}
	return { v: 2, r: decoded.r, s: decoded.s, id: decoded.id };
}

function encodeDateCursor(sentDate: number, threadMessageId: string): string {
	return Buffer.from(
		JSON.stringify({ s: sentDate, id: threadMessageId }),
	).toString("base64");
}

function decodeDateCursor(token: string): DateCursor {
	const decoded = decodeToken(token, "base64");
	if (typeof decoded.s !== "number" || typeof decoded.id !== "string") {
		throw new BadRequestError("Invalid continuationToken");
	}
	return { s: decoded.s, id: decoded.id };
}

function encodeAccountCursor(threadMessageId: string): string {
	return Buffer.from(JSON.stringify({ id: threadMessageId })).toString(
		"base64",
	);
}

function decodeAccountCursor(token: string): AccountCursor {
	const decoded = decodeToken(token, "base64");
	if (typeof decoded.id !== "string") {
		throw new BadRequestError("Invalid continuationToken");
	}
	return { id: decoded.id };
}

// ─── Schema ──────────────────────────────────────────────────────────────────

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
		...(row.listId !== null ? { listId: row.listId } : {}),
	};
}

// ─── Search predicates ────────────────────────────────────────────────────────

// The accent-/case-insensitive substring predicates are the one engine-specific
// text-search seam; they live in ./thread-search-predicates.ts (the FTS5 trigram
// index, with a folded LIKE fallback below three characters, RFC 036 D4).

/**
 * Whether the row's From address is muted, as a correlated subquery over the
 * Address table.
 *
 * Muting is a flag on the address rather than a column on the row, so this is
 * the one criterion that reaches outside `thread_message` — the read path
 * denormalizes it onto the response afterwards, which is too late to count by.
 * `normalized_email` is written folded, on the same rule the fold here applies,
 * so the two meet. Both sides are already scoped to one account config, and
 * correlating on that rather than binding it keeps the predicate usable from
 * every caller without threading the id through.
 */
const mutedSender = (): SQL =>
	sql`exists (select 1 from ${addressTable} where ${addressTable.accountConfigId} = ${threadMessageTable.accountConfigId} and ${addressTable.normalizedEmail} = lower(coalesce(${threadMessageTable.fromEmail}, '')) and json_extract(coalesce(nullif(${addressTable.flags}, ''), '{}'), '$.muted.value') = 1)`;

// The columns the search index is built from; an update that sets none of them
// leaves the index as it is.
const touchesSearchIndex = (input: UpdateThreadMessageInput): boolean =>
	input.mailboxId !== undefined ||
	input.sentDate !== undefined ||
	input.listId !== undefined ||
	input.subject !== undefined ||
	input.fromName !== undefined ||
	input.fromEmail !== undefined ||
	input.snippet !== undefined;

const queryTerms = (query: string | undefined): string[] =>
	query ? query.split(/\s+/).filter(Boolean) : [];

// The two halves of a search: the text condition, over the search index, and
// the conditions over the thread message row itself.
interface SearchConditions {
	text: SQL | undefined;
	row: SQL[];
}

// Translate SearchOptions into conditions: subject/from/query as indexed text
// predicates, muted as a subquery over the sender's address, the rest as plain
// column equalities. A multi-word `query` matches rows where every token
// appears in the subject, the from fields or the body preview (AND across
// tokens, OR across fields) — the same shape as the DynamoDB model.
function buildSearchConditions(search: SearchOptions): SearchConditions {
	const text: SQL[] = [];
	if (search.subject) text.push(subjectMatch(search.subject));
	if (search.from) text.push(fromMatch(search.from));
	for (const token of queryTerms(search.query)) {
		text.push(
			sql`(${subjectMatch(token)} or ${fromMatch(token)} or ${bodyMatch(token)})`,
		);
	}

	const row: SQL[] = [];
	if (search.muted !== undefined) {
		row.push(search.muted ? mutedSender() : sql`not ${mutedSender()}`);
	}
	if (search.unread !== undefined) {
		row.push(eq(threadMessageTable.isRead, !search.unread));
	}
	if (search.starred !== undefined) {
		row.push(eq(threadMessageTable.hasStars, search.starred));
	}
	if (search.attachments !== undefined) {
		row.push(eq(threadMessageTable.hasAttachment, search.attachments));
	}
	// An equality over a column on the row, so it sits inside the keyset window
	// rather than filtering what the window returned: a page is a full page of
	// matches however rare the category is. Served by
	// tm_by_mailbox_category_date.
	if (search.category?.length) {
		row.push(inArray(threadMessageTable.category, search.category));
	}

	return { text: text.length > 0 ? and(...text) : undefined, row };
}

const fieldTermCondition = (term: ThreadMessageFieldTerm): SQL => {
	if (term.field === "subject") return subjectMatch(term.contains);
	if (term.field === "listId") return listIdMatch(term.contains);
	return fromMatch(term.contains);
};

// Combine the caller's terms into one condition, or `undefined` when there are
// none — an empty set narrows nothing, which is what both operators mean here.
//
// A term this engine cannot evaluate faithfully ({@link isNarrowableTerm}) is
// left out rather than emitted: under `and` a missing conjunct only widens the
// candidate set, which the caller refines anyway, but under `or` a missing
// branch loses matches outright, so the whole narrowing goes.
function buildFieldTermCondition(
	terms: readonly ThreadMessageFieldTerm[],
	operator: "and" | "or",
): SQL | undefined {
	const narrowable = terms.filter((term) => isNarrowableTerm(term.contains));
	if (operator === "or" && narrowable.length !== terms.length) return undefined;
	const conditions = narrowable.map(fieldTermCondition);
	if (conditions.length === 0) return undefined;
	return operator === "or" ? or(...conditions) : and(...conditions);
}

const CANDIDATES_PER_READ = 500;

/**
 * Where a count over a text search stops. Without text a count is one
 * aggregate; with text it walks the matches, and a number past this is not
 * worth walking further for.
 */
export const TEXT_SEARCH_COUNT_CAP = 1000;

// A list of ids bound as one JSON parameter, however long it is.
const inJson = (column: SQLWrapper, values: readonly string[]): SQL =>
	sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;

interface PageQuery {
	accountConfigId: string;
	mailboxIds?: readonly string[];
	text: SQL | undefined;
	rank?: SQL<number>;
	row: Array<SQL | undefined>;
	order: "asc" | "desc";
	after: SearchPosition | null;
	limit: number;
}

type RankedRow = Row & { rank: number };

const positionOf = (cursor: DateCursor | RankedDateCursor | null) =>
	cursor
		? {
				rank: "r" in cursor ? cursor.r : 0,
				sentDate: cursor.s,
				threadMessageId: cursor.id,
			}
		: null;

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
	constructor(
		private readonly db: Db<Record<string, unknown>>,
		private readonly search: SearchIndex,
	) {}

	/**
	 * One page of rows in date order (ranked first when asked). Without a text
	 * condition it is one query over the mail database. With one, the search
	 * index finds, scopes and orders the matches and hands over a page of ids at
	 * a time; the mail database keeps the ones its own conditions accept, until
	 * the page is full or the matches run out.
	 */
	private async page(query: PageQuery): Promise<RankedRow[]> {
		if (!query.text) {
			const rows = await this.db
				.select()
				.from(threadMessageTable)
				.where(
					and(
						eq(threadMessageTable.accountConfigId, query.accountConfigId),
						query.mailboxIds
							? inArray(threadMessageTable.mailboxId, [...query.mailboxIds])
							: undefined,
						...query.row,
						sentDateCursorCond(
							query.order,
							query.after && {
								s: query.after.sentDate,
								id: query.after.threadMessageId,
							},
						),
					),
				)
				.orderBy(
					query.order === "desc"
						? desc(threadMessageTable.sentDate)
						: asc(threadMessageTable.sentDate),
					asc(threadMessageTable.threadMessageId),
				)
				.limit(query.limit);
			return rows.map((row) => ({ ...row, rank: 0 }));
		}

		const page: RankedRow[] = [];
		await this.eachMatch({ ...query, text: query.text }, (rows) => {
			page.push(...rows.slice(0, query.limit - page.length));
			return page.length < query.limit;
		});
		return page;
	}

	/**
	 * Walk every match of a text query in order, a page of candidates at a
	 * time, handing each page's accepted rows to `visit` until it returns false.
	 */
	/**
	 * The mail rows behind one page of candidates, kept to the query's folder
	 * scope and row conditions: a candidate the index still holds for a row
	 * that has since moved folders, or gone, does not come back.
	 */
	private matchedRows(
		query: Omit<PageQuery, "limit" | "text" | "after" | "order">,
		ids: readonly string[],
	) {
		return and(
			eq(threadMessageTable.accountConfigId, query.accountConfigId),
			inJson(threadMessageTable.threadMessageId, ids),
			query.mailboxIds
				? inJson(threadMessageTable.mailboxId, query.mailboxIds)
				: undefined,
			...query.row,
		);
	}

	/**
	 * Walk every match of a text query in order, a page of candidates at a
	 * time, handing each page's accepted rows to `visit` until it returns false.
	 */
	private async eachMatch(
		query: Omit<PageQuery, "limit" | "text"> & { text: SQL },
		visit: (rows: RankedRow[]) => boolean,
	): Promise<void> {
		let after = query.after;
		for (;;) {
			const candidates = await this.search.candidates({
				accountConfigId: query.accountConfigId,
				mailboxIds: query.mailboxIds,
				where: query.text,
				rank: query.rank,
				order: query.order,
				after,
				limit: CANDIDATES_PER_READ,
			});
			const last = candidates.at(-1);
			if (!last) return;
			const rows = await this.db
				.select()
				.from(threadMessageTable)
				.where(
					this.matchedRows(
						query,
						candidates.map((candidate) => candidate.threadMessageId),
					),
				);
			const byId = new Map(rows.map((row) => [row.threadMessageId, row]));
			const accepted = candidates.flatMap((candidate) => {
				const row = byId.get(candidate.threadMessageId);
				return row ? [{ ...row, rank: candidate.rank }] : [];
			});
			if (!visit(accepted)) return;
			if (candidates.length < CANDIDATES_PER_READ) return;
			after = last;
		}
	}

	/**
	 * How many rows a search accepts, or how many conversations they belong to.
	 * Without a text condition it is one COUNT; with one it walks the matches,
	 * reading only their thread ids, and stops at {@link TEXT_SEARCH_COUNT_CAP}.
	 */
	private async countMatches(
		query: Omit<PageQuery, "limit" | "after" | "order">,
		unit: "rows" | "threads",
	): Promise<number> {
		if (!query.text) {
			const [{ count }] = await this.db
				.select({
					count:
						unit === "threads"
							? sql<number>`cast(count(distinct ${threadMessageTable.threadId}) as int)`
							: sql<number>`cast(count(*) as int)`,
				})
				.from(threadMessageTable)
				.where(
					and(
						eq(threadMessageTable.accountConfigId, query.accountConfigId),
						query.mailboxIds
							? inArray(threadMessageTable.mailboxId, [...query.mailboxIds])
							: undefined,
						...query.row,
					),
				);
			return count;
		}
		const threads = new Set<string>();
		let rows = 0;
		let after: SearchPosition | null = null;
		for (;;) {
			const candidates = await this.search.candidates({
				accountConfigId: query.accountConfigId,
				mailboxIds: query.mailboxIds,
				where: query.text,
				order: "desc",
				after,
				limit: CANDIDATES_PER_READ,
			});
			const last = candidates.at(-1);
			if (!last) break;
			const matched = await this.db
				.select({ threadId: threadMessageTable.threadId })
				.from(threadMessageTable)
				.where(
					this.matchedRows(
						query,
						candidates.map((candidate) => candidate.threadMessageId),
					),
				);
			rows += matched.length;
			for (const row of matched) threads.add(row.threadId);
			const counted = unit === "threads" ? threads.size : rows;
			if (counted >= TEXT_SEARCH_COUNT_CAP) return TEXT_SEARCH_COUNT_CAP;
			if (candidates.length < CANDIDATES_PER_READ) break;
			after = last;
		}
		return unit === "threads" ? threads.size : rows;
	}

	async close(): Promise<void> {
		const client = (this.db as unknown as { $client?: unknown }).$client;
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
			listId: input.listId ?? null,
			createdAt: now,
			updatedAt: now,
		};
		const [inserted] = await this.db
			.insert(threadMessageTable)
			.values(row)
			.onConflictDoNothing()
			.returning();
		if (inserted) {
			await this.search.sync([threadMessageId]);
			return toItem(inserted);
		}

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
						inList(threadMessageTable.threadMessageId, threadMessageId),
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
		if (input.listId !== undefined) set.listId = input.listId;
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
		if (touchesSearchIndex(input)) await this.search.sync([threadMessageId]);
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
		await this.search.sync([threadMessageId]);
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
					inList(threadMessageTable.threadMessageId, ids),
				),
			);
		await this.search.sync(ids);
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
			search?: SearchOptions;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const search = options?.search
			? buildSearchConditions(options.search)
			: { text: undefined, row: [] };
		const rows = await this.page({
			accountConfigId,
			mailboxIds: options?.inboxMailboxIds?.size
				? [...options.inboxMailboxIds]
				: undefined,
			text: search.text,
			row: [
				options?.excludeDeleted
					? eq(threadMessageTable.isDeleted, false)
					: undefined,
				...search.row,
			],
			order: options?.order ?? "desc",
			after: positionOf(
				options?.continuationToken
					? decodeDateCursor(options.continuationToken)
					: null,
			),
			limit: options?.limit ?? 100,
		});

		const lastRow = rows.at(-1);
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
	 * builder as `searchByMailboxWindow`, with the mailbox equality swapped for
	 * the caller's scope set. Sender matches rank first, then date order; a
	 * cursor minted before the ranking finishes its session in date order. Matching runs in SQL over the
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
		const limit = clampThreadSearchLimit(options?.limit);
		const cursor = options?.continuationToken
			? decodeSearchCursor(options.continuationToken)
			: null;
		const ranked = cursor?.v !== 1;
		const terms = queryTerms(search.query);
		const conditions = buildSearchConditions(search);

		const rows = await this.page({
			accountConfigId,
			mailboxIds: options?.mailboxIds?.size
				? [...options.mailboxIds]
				: undefined,
			text: conditions.text,
			rank: ranked && terms.length > 0 ? senderMatchRank(terms) : undefined,
			row: [
				options?.excludeDeleted
					? eq(threadMessageTable.isDeleted, false)
					: undefined,
				...conditions.row,
			],
			order: options?.order ?? "desc",
			after: positionOf(cursor),
			limit,
		});

		const lastRow = rows.at(-1);
		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && lastRow
					? ranked
						? encodeRankedDateCursor(
								lastRow.rank,
								lastRow.sentDate,
								lastRow.threadMessageId,
							)
						: encodeDateCursor(lastRow.sentDate, lastRow.threadMessageId)
					: undefined,
		};
	}

	/**
	 * Cross-mailbox narrowing for a rule back-apply. Same date keyset cursor
	 * and ordering as `listByDate`, with the terms combined under the caller's
	 * operator instead of the AND-only `SearchOptions` shape a search box needs.
	 * The terms run in SQL over the whole config, so a page is a page of
	 * narrowed rows and a rule for a sender that has been quiet for a month
	 * reaches its mail (#459).
	 */
	async listByFieldTerms(
		accountConfigId: string,
		terms: readonly ThreadMessageFieldTerm[],
		options?: {
			operator?: "and" | "or";
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			excludeDeleted?: boolean;
			mailboxIds?: readonly string[];
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const limit = clampThreadSearchLimit(options?.limit);
		const rows = await this.page({
			accountConfigId,
			mailboxIds: options?.mailboxIds,
			text: buildFieldTermCondition(terms, options?.operator ?? "and"),
			row: [
				options?.excludeDeleted
					? eq(threadMessageTable.isDeleted, false)
					: undefined,
			],
			order: options?.order ?? "desc",
			after: positionOf(
				options?.continuationToken
					? decodeDateCursor(options.continuationToken)
					: null,
			),
			limit,
		});

		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && rows.at(-1)
					? encodeDateCursor(
							rows[rows.length - 1].sentDate,
							rows[rows.length - 1].threadMessageId,
						)
					: undefined,
		};
	}

	/**
	 * COUNT of matching CONVERSATIONS over the SAME predicate as the
	 * cross-account listings, across the caller's mailbox scope.
	 *
	 * Distinct on `threadId` because that is the unit the listing renders: a row
	 * is per mailbox, so one message reachable through a real folder and a
	 * virtual copy of it is several rows, and two matching messages of one
	 * conversation are two more. Both collapse in the list, and a count that did
	 * not collapse with them would name a different set than the rows it sits
	 * above.
	 *
	 * `hasStars` is not special-cased: the starred mode passes `starred: true` in
	 * `search`, so one method counts what any of the three modes lists.
	 */
	async countThreadsInScope(
		accountConfigId: string,
		search: SearchOptions,
		options?: {
			mailboxIds?: Set<string>;
			excludeDeleted?: boolean;
		},
	): Promise<number> {
		const conditions = buildSearchConditions(search);
		return this.countMatches(
			{
				accountConfigId,
				mailboxIds: options?.mailboxIds?.size
					? [...options.mailboxIds]
					: undefined,
				text: conditions.text,
				row: [
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					...conditions.row,
				],
			},
			"threads",
		);
	}

	async listByStarred(
		accountConfigId: string,
		options?: {
			order?: "asc" | "desc";
			limit?: number;
			continuationToken?: string;
			mailboxIds?: Set<string>;
			excludeDeleted?: boolean;
			search?: SearchOptions;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		// Default before the has-more check, or an absent limit silently truncates
		// at the implicit cap with no continuation token.
		const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
		const search = options?.search
			? buildSearchConditions(options.search)
			: { text: undefined, row: [] };
		const rows = await this.page({
			accountConfigId,
			mailboxIds: options?.mailboxIds?.size
				? [...options.mailboxIds]
				: undefined,
			text: search.text,
			row: [
				eq(threadMessageTable.hasStars, true),
				options?.excludeDeleted
					? eq(threadMessageTable.isDeleted, false)
					: undefined,
				...search.row,
			],
			order: options?.order ?? "desc",
			after: positionOf(
				options?.continuationToken
					? decodeDateCursor(options.continuationToken)
					: null,
			),
			limit,
		});

		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && rows.at(-1)
					? encodeDateCursor(
							rows[rows.length - 1].sentDate,
							rows[rows.length - 1].threadMessageId,
						)
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

	async rekeyThread(
		accountConfigId: string,
		fromThreadId: string,
		toThreadId: string,
	): Promise<{ moved: number; dropped: number }> {
		if (fromThreadId === toThreadId) return { moved: 0, dropped: 0 };
		const rows = await this.db
			.select({
				threadMessageId: threadMessageTable.threadMessageId,
				messageId: threadMessageTable.messageId,
			})
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.threadId, fromThreadId),
				),
			);
		if (rows.length === 0) return { moved: 0, dropped: 0 };

		// Per row: drop it when the target row already exists, otherwise move it
		// onto the target id. The delete runs first, so the two statements never
		// both apply to one row, and a rerun finds only rows a failed run left.
		const items = rows.flatMap((row) => {
			const target = deriveThreadMessageId(toThreadId, row.messageId);
			const targetStored = exists(
				this.db
					.select({ threadMessageId: threadMessageTable.threadMessageId })
					.from(threadMessageTable)
					.where(eq(threadMessageTable.threadMessageId, target)),
			);
			const source = and(
				eq(threadMessageTable.threadMessageId, row.threadMessageId),
				eq(threadMessageTable.threadId, fromThreadId),
			);
			return [
				this.db
					.delete(threadMessageTable)
					.where(and(source, targetStored))
					.returning({ threadMessageId: threadMessageTable.threadMessageId }),
				this.db
					.update(threadMessageTable)
					.set({ threadId: toThreadId, threadMessageId: target })
					.where(and(source, not(targetStored)))
					.returning({ threadMessageId: threadMessageTable.threadMessageId }),
			];
		});
		const results = await runBatch(this.db, items);
		await this.search.sync(
			rows.flatMap((row) => [
				row.threadMessageId,
				deriveThreadMessageId(toThreadId, row.messageId),
			]),
		);
		const count = (parity: number): number =>
			results.reduce<number>(
				(total, result, index) =>
					index % 2 === parity && Array.isArray(result)
						? total + result.length
						: total,
				0,
			);
		return { moved: count(1), dropped: count(0) };
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
		const limit = options?.count ?? 100;
		const conditions = buildSearchConditions(search);
		const rows = await this.page({
			accountConfigId,
			mailboxIds: [mailboxId],
			text: conditions.text,
			row: [
				options?.excludeDeleted
					? eq(threadMessageTable.isDeleted, false)
					: undefined,
				...conditions.row,
			],
			order: options?.order ?? "desc",
			after: positionOf(
				options?.continuationToken
					? decodeDateCursor(options.continuationToken)
					: null,
			),
			limit,
		});

		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && rows.at(-1)
					? encodeDateCursor(
							rows[rows.length - 1].sentDate,
							rows[rows.length - 1].threadMessageId,
						)
					: undefined,
		};
	}

	/**
	 * Mailbox search for `searchThreads`. Matching (subject / from / query and
	 * the boolean filters) runs in SQL over the whole mailbox via the trigram
	 * indexes, ordered by sent_date with an id tiebreak. `limit` is a page size
	 * over MATCHES (clamped to THREAD_SEARCH_MAX_LIMIT); the DynamoDB name is
	 * kept for interface parity, but there is no recent-window read bound — the
	 * text is indexed, so a match anywhere in the mailbox is reachable.
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
			attributes?: string[];
			continuationToken?: string;
			excludeDeleted?: boolean;
		},
	): Promise<ResultList<ThreadMessageItem>> {
		const limit = clampThreadSearchLimit(options?.limit);
		const conditions = buildSearchConditions(search);
		const rows = await this.page({
			accountConfigId,
			mailboxIds: [mailboxId],
			text: conditions.text,
			row: [
				options?.excludeDeleted
					? eq(threadMessageTable.isDeleted, false)
					: undefined,
				...conditions.row,
			],
			order: options?.order ?? "desc",
			after: positionOf(
				options?.continuationToken
					? decodeDateCursor(options.continuationToken)
					: null,
			),
			limit,
		});

		return {
			items: rows.map(toItem),
			continuationToken:
				rows.length === limit && rows.at(-1)
					? encodeDateCursor(
							rows[rows.length - 1].sentDate,
							rows[rows.length - 1].threadMessageId,
						)
					: undefined,
		};
	}

	/**
	 * COUNT of matches over the SAME predicate as `searchByMailboxWindow`, over
	 * the whole mailbox. `THREAD_SEARCH_MAX_LIMIT` bounds a page of rows; a count
	 * returns no rows, so it is answered in full however many messages match.
	 */
	async countByMailbox(
		accountConfigId: string,
		mailboxId: string,
		search: SearchOptions,
		options?: {
			excludeDeleted?: boolean;
			order?: "asc" | "desc";
		},
	): Promise<number> {
		const conditions = buildSearchConditions(search);
		return this.countMatches(
			{
				accountConfigId,
				mailboxIds: [mailboxId],
				text: conditions.text,
				row: [
					options?.excludeDeleted
						? eq(threadMessageTable.isDeleted, false)
						: undefined,
					...conditions.row,
				],
			},
			"rows",
		);
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
		await this.search.removeAccount(accountConfigId);
		return result.length;
	}
}
