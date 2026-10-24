import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { runBatch, type SqliteBatchItem } from "../batch.js";
import type { Db } from "../db.js";
import { threadMessageTable } from "../schema/thread-message.js";

// The FTS5 trigram table the search migration set creates
// (deploy/vps/migrations-sqlite/search). drizzle-kit cannot express a virtual
// table, so its DDL is that committed migration and this declaration only lets
// drizzle build statements against it; no drizzle-kit config reads it.
export const threadMessageSearchTable = sqliteTable("thread_message_fts", {
	rowid: integer("rowid").notNull(),
	threadMessageId: text("thread_message_id").notNull(),
	accountConfigId: text("account_config_id").notNull(),
	subject: text("subject").notNull(),
	sender: text("sender").notNull(),
	body: text("body").notNull(),
});

type AnyDb = Db<Record<string, unknown>>;

type SearchDocument = typeof threadMessageSearchTable.$inferInsert;

// D1 refuses a statement with more than 100 bound parameters. A document is six
// parameters, so fifteen documents per insert stay under it.
const DOCUMENTS_PER_STATEMENT = 15;
const DOCUMENTS_PER_REBUILD_PAGE = DOCUMENTS_PER_STATEMENT * 20;

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
	subject: threadMessageTable.subject,
	fromName: threadMessageTable.fromName,
	fromEmail: threadMessageTable.fromEmail,
	snippet: threadMessageTable.snippet,
};

interface IndexedRow {
	threadMessageId: string;
	accountConfigId: string;
	subject: string | null;
	fromName: string | null;
	fromEmail: string | null;
	snippet: string | null;
}

const toDocument = (row: IndexedRow): SearchDocument => ({
	rowid: searchRowid(row.threadMessageId),
	threadMessageId: row.threadMessageId,
	accountConfigId: row.accountConfigId,
	subject: row.subject ?? "",
	sender: `${row.fromName ?? ""} ${row.fromEmail ?? ""}`,
	body: row.snippet ?? "",
});

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		chunks.push(items.slice(start, start + size));
	}
	return chunks;
};

/**
 * The thread-message search index, kept in its own database.
 *
 * It is written after the mail write it follows has committed, and never in
 * the same batch: a write reads the rows it names back from the mail database
 * and makes the index match them, so repeating one is harmless and a missed one
 * is repaired by the next write to that row or by {@link rebuild}.
 */
export class SearchIndex {
	constructor(
		private readonly mail: AnyDb,
		private readonly search: AnyDb,
	) {}

	/** Make the index match the mail database for these thread messages. */
	async sync(threadMessageIds: readonly string[]): Promise<void> {
		const ids = [...new Set(threadMessageIds)];
		for (const slice of chunk(ids, DOCUMENTS_PER_STATEMENT)) {
			const rows = await this.mail
				.select(indexedColumns)
				.from(threadMessageTable)
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
			await runBatch(this.search, items);
		}
	}

	async removeAccount(accountConfigId: string): Promise<void> {
		await this.search
			.delete(threadMessageSearchTable)
			.where(eq(threadMessageSearchTable.accountConfigId, accountConfigId));
	}

	/** The thread message ids whose documents match an FTS5 query. */
	async matching(
		accountConfigId: string,
		matchExpression: string,
	): Promise<string[]> {
		const rows = await this.search
			.select({ threadMessageId: threadMessageSearchTable.threadMessageId })
			.from(threadMessageSearchTable)
			.where(
				and(
					eq(threadMessageSearchTable.accountConfigId, accountConfigId),
					sql`${threadMessageSearchTable} match ${matchExpression}`,
				),
			);
		return rows.map((row) => row.threadMessageId);
	}

	/**
	 * Whether the index holds nothing while the mail database holds thread
	 * messages: a search database that is new beside an existing mail database,
	 * or one deleted to be rebuilt.
	 */
	async needsRebuild(): Promise<boolean> {
		const [document] = await this.search
			.select({ rowid: threadMessageSearchTable.rowid })
			.from(threadMessageSearchTable)
			.limit(1);
		if (document) return false;
		const [thread] = await this.mail
			.select({ threadMessageId: threadMessageTable.threadMessageId })
			.from(threadMessageTable)
			.limit(1);
		return thread !== undefined;
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
				.where(gt(threadMessageTable.threadMessageId, after))
				.orderBy(asc(threadMessageTable.threadMessageId))
				.limit(DOCUMENTS_PER_REBUILD_PAGE);
			const last = rows.at(-1);
			if (!last) return indexed;
			await runBatch(
				this.search,
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
