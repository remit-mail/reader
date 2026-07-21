import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const instance_owner = pgTable(
	"instance_owner",
	{
		id: integer("id").primaryKey().default(1),
		userId: text("user_id").notNull(),
		claimedAt: timestamp("claimed_at").defaultNow().notNull(),
	},
	(table) => [check("instance_owner_singleton", sql`${table.id} = 1`)],
);
