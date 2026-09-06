import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Transactional outbox. It has no TypeSpec entity — it is infrastructure for
 * the search-index worker (append a row per body change / move, drain by id,
 * mark `processed_at`). The partial index selects unprocessed rows for the
 * short-cadence poll (RFC 036 D2).
 *
 * Exported raw for committed-migration generation (schema-full-sqlite) as well
 * as for the repos and the drain logic.
 */
/**
 * The event vocabulary a producer may append. Every kind here is drained by the
 * search-index relay (`DRAIN_EVENTS`); a kind nothing drains accumulates
 * undrained rows forever, which is what `message.created` did (reader#1063).
 * The column carries the union so a new producer cannot invent a kind without
 * adding it here, where the drain-coverage test picks it up.
 */
export const OUTBOX_EVENTS = [
	"message.body_synced",
	"message.moved",
	"message.removed",
] as const;

export type OutboxEvent = (typeof OUTBOX_EVENTS)[number];

export const outboxTable = sqliteTable(
	"outbox",
	{
		id: text("id").primaryKey(),
		messageId: text("message_id").notNull(),
		event: text("event", { enum: OUTBOX_EVENTS }).notNull(),
		payload: text("payload", { mode: "json" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
		processedAt: integer("processed_at", { mode: "number" }),
	},
	(t) => [
		index("outbox_message_id_idx").on(t.messageId),
		index("outbox_unprocessed_idx")
			.on(t.createdAt)
			.where(sql`${t.processedAt} IS NULL`),
	],
);
