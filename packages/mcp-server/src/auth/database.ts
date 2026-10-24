import Database from "better-sqlite3";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";

export interface McpAuthDatabases {
	db: BetterSQLite3Database;
	readonlyDb: BetterSQLite3Database;
	close: () => void;
}

export const openMcpAuthDatabases = (filename: string): McpAuthDatabases => {
	const sqlite = new Database(filename);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("foreign_keys = ON");
	const readonly = new Database(filename, {
		readonly: true,
		fileMustExist: true,
	});
	readonly.pragma("busy_timeout = 5000");
	return {
		db: drizzle(sqlite),
		readonlyDb: drizzle(readonly),
		close: () => {
			readonly.close();
			sqlite.close();
		},
	};
};
