import { parseArgs } from "node:util";
import { logger } from "../../logger-lambda/src/logger.js";
import { splitSqlite } from "./split-sqlite.js";

/**
 * `node split-sqlite.mjs --source <old remit.db> --app <app.db> --mail <mail.db>
 * --search <search.db>`, run once by hand with the stack stopped (#1420). The
 * targets are the paths the compose file gives SQLITE_APP_DB_PATH,
 * SQLITE_MAIL_DB_PATH and SQLITE_SEARCH_DB_PATH. The source is only read.
 */
const { values } = parseArgs({
	options: {
		source: { type: "string" },
		app: { type: "string" },
		mail: { type: "string" },
		search: { type: "string" },
		migrations: { type: "string", default: "." },
	},
	strict: true,
});

const required = (name: keyof typeof values): string => {
	const value = values[name];
	if (!value) throw new Error(`--${name} is required`);
	return value;
};

splitSqlite({
	source: required("source"),
	targets: {
		app: required("app"),
		mail: required("mail"),
		search: required("search"),
	},
	migrationsRoot: required("migrations"),
})
	.then((copied) => {
		// biome-ignore lint/plugin/no-logger-info: the one record of what the move copied
		logger.info({ copied }, "split done");
		process.exit(0);
	})
	.catch((error: unknown) => {
		logger.error({ error }, "split failed");
		process.exit(1);
	});
