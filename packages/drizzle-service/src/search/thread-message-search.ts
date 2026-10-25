import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SqliteBatchItem, WriteBatch } from "../batch.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import { messageSearchTextTable } from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";

// The FTS5 table the search migration set creates
// (deploy/vps/migrations-sqlite/search). drizzle-kit cannot express a virtual
// table, so its DDL is that committed migration and this declaration only lets
// drizzle build statements against it; no drizzle-kit config reads it.
export const threadMessageSearchTable = sqliteTable("thread_message_fts", {
	rowid: integer("rowid").notNull(),
	threadMessageId: text("thread_message_id").notNull(),
	accountConfigId: text("account_config_id").notNull(),
	mailboxId: text("mailbox_id").notNull(),
	sentDate: integer("sent_date").notNull(),
	listId: text("list_id").notNull(),
	subject: text("subject").notNull(),
	sender: text("sender").notNull(),
	body: text("body").notNull(),
});

type AnyDb = RepositoryDb<Record<string, unknown>>;

type SearchDocument = typeof threadMessageSearchTable.$inferInsert;

// D1 refuses a statement with more than 100 bound parameters. A document is
// nine parameters, so ten documents per insert stay under it.
const DOCUMENTS_PER_STATEMENT = 10;
const DOCUMENTS_PER_REBUILD_PAGE = DOCUMENTS_PER_STATEMENT * 30;

// The document's rowid, derived from its thread message id so a write or a
// removal finds the document without a lookup. 53 bits, the integers a number
// carries exactly on every driver.
export const searchRowid = (threadMessageId: string): number => {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let index = 0; index < threadMessageId.length; index++) {
		const code = threadMessageId.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const indexedColumns = {
	threadMessageId: threadMessageTable.threadMessageId,
	accountConfigId: threadMessageTable.accountConfigId,
	mailboxId: threadMessageTable.mailboxId,
	sentDate: threadMessageTable.sentDate,
	listId: threadMessageTable.listId,
	subject: threadMessageTable.subject,
	fromName: threadMessageTable.fromName,
	fromEmail: threadMessageTable.fromEmail,
	searchText: messageSearchTextTable.text,
};

interface IndexedRow {
	threadMessageId: string;
	accountConfigId: string;
	mailboxId: string;
	sentDate: number;
	listId: string | null;
	subject: string | null;
	fromName: string | null;
	fromEmail: string | null;
	searchText: string | null;
}

const toDocument = (row: IndexedRow): SearchDocument => ({
	rowid: searchRowid(row.threadMessageId),
	threadMessageId: row.threadMessageId,
	accountConfigId: row.accountConfigId,
	mailboxId: row.mailboxId,
	sentDate: row.sentDate,
	listId: row.listId ?? "",
	subject: row.subject ?? "",
	sender: `${row.fromName ?? ""} ${row.fromEmail ?? ""}`,
	body: row.searchText ?? "",
});

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		chunks.push(items.slice(start, start + size));
	}
	return chunks;
};

/** Where a page of candidates resumes: the last one the previous page held. */
export interface SearchPosition {
	rank: number;
	sentDate: number;
	threadMessageId: string;
}

export type SearchCandidate = SearchPosition;

export interface CandidateQuery {
	accountConfigId: string;
	/** The mailboxes in scope; every mailbox of the config when absent. */
	mailboxIds?: readonly string[];
	/** The text condition, over the columns of {@link threadMessageSearchTable}. */
	where: SQL;
	/** Ranks first, highest first, when given. */
	rank?: SQL<number>;
	order: "asc" | "desc";
	after: SearchPosition | null;
	limit: number;
}

/**
 * The thread-message search index, kept in its own database.
 *
 * It is written after the mail write it follows has committed, and never in
 * the same batch: a write reads the rows it names back from the mail database
 * and makes the index match them, so repeating one is harmless and a missed one
 * is repaired by the next write to that row or by {@link rebuild}.
 *
 * A search is answered here — matched, scoped to its mailboxes, ordered and
 * cut to a page — and the mail database is then asked for that page's rows
 * only, so no statement carries more ids than a page holds.
 */
export class SearchIndex {
	private readonly search: AnyDb;
	private readonly batch: WriteBatch;

	constructor(
		private readonly mail: AnyDb,
		store: SqliteStore<Record<string, unknown>>,
	) {
		this.search = store.db;
		this.batch = store.batch;
	}

	/** Make the index match the mail database for these thread messages. */
	async sync(threadMessageIds: readonly string[]): Promise<void> {
		const ids = [...new Set(threadMessageIds)];
		for (const slice of chunk(ids, DOCUMENTS_PER_STATEMENT)) {
			const rows = await this.mail
				.select(indexedColumns)
				.from(threadMessageTable)
				.leftJoin(
					messageSearchTextTable,
					eq(messageSearchTextTable.messageId, threadMessageTable.messageId),
				)
				.where(inArray(threadMessageTable.threadMessageId, slice));
			const items: SqliteBatchItem[] = [
				this.search
					.delete(threadMessageSearchTable)
					.where(
						inArray(threadMessageSearchTable.rowid, slice.map(searchRowid)),
					),
			];
			if (rows.length > 0) {
				items.push(
					this.search
						.insert(threadMessageSearchTable)
						.values(rows.map(toDocument)),
				);
			}
			await this.batch(items);
		}
	}

	async removeAccount(accountConfigId: string): Promise<void> {
		await this.search
			.delete(threadMessageSearchTable)
			.where(eq(threadMessageSearchTable.accountConfigId, accountConfigId));
	}

	/** One page of matching thread messages, in the query's order. */
	async candidates(query: CandidateQuery): Promise<SearchCandidate[]> {
		const table = threadMessageSearchTable;
		// The rank is computed once, in the inner select, and read by name
		// after it: written out in the keyset and the ordering it would bind
		// every term's parameters four times.
		const matches = this.search
			.select({
				threadMessageId: table.threadMessageId,
				sentDate: table.sentDate,
				rank: (query.rank ?? sql<number>`0`).as("sender_rank"),
			})
			.from(table)
			.where(
				and(
					eq(table.accountConfigId, query.accountConfigId),
					query.mailboxIds
						? sql`${table.mailboxId} in (select value from json_each(${JSON.stringify(query.mailboxIds)}))`
						: undefined,
					query.where,
				),
			)
			.as("matches");
		const { after } = query;
		const dateAfter = after
			? or(
					query.order === "desc"
						? lt(matches.sentDate, after.sentDate)
						: gt(matches.sentDate, after.sentDate),
					and(
						eq(matches.sentDate, after.sentDate),
						gt(matches.threadMessageId, after.threadMessageId),
					),
				)
			: undefined;
		const keyset =
			after && query.rank
				? or(
						lt(matches.rank, after.rank),
						and(eq(matches.rank, after.rank), dateAfter),
					)
				: dateAfter;
		return this.search
			.select()
			.from(matches)
			.where(keyset)
			.orderBy(
				...(query.rank ? [desc(matches.rank)] : []),
				query.order === "desc" ? desc(matches.sentDate) : asc(matches.sentDate),
				asc(matches.threadMessageId),
			)
			.limit(query.limit);
	}

	/**
	 * Whether the index has fallen out of step with the mail database: a
	 * different number of documents than thread messages, as a new or deleted
	 * search database, or a write that died between the two, leaves it.
	 */
	async needsRebuild(): Promise<boolean> {
		const [[documents], [threads]] = await Promise.all([
			this.search.select({ n: count() }).from(threadMessageSearchTable),
			this.mail.select({ n: count() }).from(threadMessageTable),
		]);
		return documents?.n !== threads?.n;
	}

	/** Drop every document and index the whole mail database again. */
	async rebuild(): Promise<number> {
		await this.search.delete(threadMessageSearchTable);
		let indexed = 0;
		let after = "";
		for (;;) {
			const rows = await this.mail
				.select(indexedColumns)
				.from(threadMessageTable)
				.leftJoin(
					messageSearchTextTable,
					eq(messageSearchTextTable.messageId, threadMessageTable.messageId),
				)
				.where(gt(threadMessageTable.threadMessageId, after))
				.orderBy(asc(threadMessageTable.threadMessageId))
				.limit(DOCUMENTS_PER_REBUILD_PAGE);
			const last = rows.at(-1);
			if (!last) return indexed;
			await this.batch(
				chunk(rows, DOCUMENTS_PER_STATEMENT).map((slice) =>
					this.search
						.insert(threadMessageSearchTable)
						.values(slice.map(toDocument)),
				),
			);
			indexed += rows.length;
			after = last.threadMessageId;
		}
	}
}
