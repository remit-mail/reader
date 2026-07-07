import {
	bodyPartContents as bodyPartContentTable,
	bodyPartParameters as bodyPartParameterTable,
	bodyPartStorages as bodyPartStorageTable,
	bodyParts as bodyPartTable,
	envelopeAddresses as envelopeAddressTable,
	envelopes as envelopeTable,
	messageFlags as messageFlagTable,
	messageReferences as messageReferenceTable,
	messages as messageTable,
	rawMessageStorages as rawMessageStorageTable,
} from "@remit/drizzle-pg-schema";
import { sql } from "drizzle-orm";
import {
	bigint,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export {
	bodyPartContentTable,
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	envelopeAddressTable,
	envelopeTable,
	messageFlagTable,
	messageReferenceTable,
	messageTable,
	rawMessageStorageTable,
};

/**
 * Postgres-only transactional outbox. It has no TypeSpec entity — it is
 * infrastructure for the search-index worker (append a row per body change /
 * move, drain by id, mark `processed_at`). The partial index selects
 * unprocessed rows for the boot-time backstop scan.
 */
export const outboxTable = pgTable(
	"outbox",
	{
		id: uuid("id").primaryKey(),
		messageId: text("message_id").notNull(),
		event: text("event").notNull(),
		payload: jsonb("payload").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		processedAt: bigint("processed_at", { mode: "number" }),
	},
	(t) => [
		index("outbox_message_id_idx").on(t.messageId),
		index("outbox_unprocessed_idx")
			.on(t.createdAt)
			.where(sql`${t.processedAt} IS NULL`),
	],
);

export const messageDataSchema = {
	envelope: envelopeTable,
	messageReference: messageReferenceTable,
	envelopeAddress: envelopeAddressTable,
	bodyPart: bodyPartTable,
	bodyPartParameter: bodyPartParameterTable,
	rawMessageStorage: rawMessageStorageTable,
	bodyPartStorage: bodyPartStorageTable,
	bodyPartContent: bodyPartContentTable,
	message: messageTable,
	messageFlag: messageFlagTable,
	outbox: outboxTable,
};

export type MessageDataSchema = typeof messageDataSchema;
