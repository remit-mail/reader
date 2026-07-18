import { sql } from "drizzle-orm";
import {
	bigint,
	jsonb,
	index as pgIndex,
	pgTable,
	text as pgText,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import {
	index as sqliteIndex,
	integer as sqliteInteger,
	sqliteTable,
	text as sqliteText,
} from "drizzle-orm/sqlite-core";
import { isSqlite } from "../dialect.js";

/**
 * Transactional outbox. It has no TypeSpec entity — it is infrastructure for
 * the search-index worker (append a row per body change / move, drain by id,
 * mark `processed_at`). The partial index selects unprocessed rows for the
 * boot-time backstop scan (Postgres) and the short-cadence poll (SQLite,
 * RFC 036 D2). It is hand-written per dialect because the two column-builder
 * sets share no surface; both keep identical column names so the repos and the
 * drain logic read the same rows on either backend.
 *
 * Both raw tables are exported for committed-migration generation (schema-full
 * per dialect). The runtime `outboxTable` is the dialect-selected one, cast to
 * the Postgres type so the repos keep one static shape (RFC 036 D1).
 */
export const pgOutboxTable = pgTable(
	"outbox",
	{
		id: uuid("id").primaryKey(),
		messageId: pgText("message_id").notNull(),
		event: pgText("event").notNull(),
		payload: jsonb("payload").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		processedAt: bigint("processed_at", { mode: "number" }),
	},
	(t) => [
		pgIndex("outbox_message_id_idx").on(t.messageId),
		pgIndex("outbox_unprocessed_idx")
			.on(t.createdAt)
			.where(sql`${t.processedAt} IS NULL`),
	],
);

export const sqliteOutboxTable = sqliteTable(
	"outbox",
	{
		id: sqliteText("id").primaryKey(),
		messageId: sqliteText("message_id").notNull(),
		event: sqliteText("event").notNull(),
		payload: sqliteText("payload", { mode: "json" }).notNull(),
		createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
		processedAt: sqliteInteger("processed_at", { mode: "number" }),
	},
	(t) => [
		sqliteIndex("outbox_message_id_idx").on(t.messageId),
		sqliteIndex("outbox_unprocessed_idx")
			.on(t.createdAt)
			.where(sql`${t.processedAt} IS NULL`),
	],
);

export const outboxTable: typeof pgOutboxTable = isSqlite()
	? (sqliteOutboxTable as unknown as typeof pgOutboxTable)
	: pgOutboxTable;
