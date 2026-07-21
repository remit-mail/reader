// SQLite twin of meta-schema.ts. Same shape in the SQLite dialect — used only
// to generate the committed SQLite migrations
// (deploy/vps/migrations-sqlite/meta); the Postgres schema stays the source
// for the pg migrations.
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const instance_owner = sqliteTable(
	"instance_owner",
	{
		id: integer("id").primaryKey().default(1),
		userId: text("user_id").notNull(),
		claimedAt: integer("claimed_at", { mode: "timestamp" })
			.$defaultFn(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [check("instance_owner_singleton", sql`${table.id} = 1`)],
);
