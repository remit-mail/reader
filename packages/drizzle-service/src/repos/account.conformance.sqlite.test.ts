import { accountRepositoryConformance } from "@remit/data-ports/conformance";
import { BETTER_SQLITE3_LIMITS } from "../bound-parameters.js";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { accountTable } from "../schema.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { messageObjectsInMemory } from "./message-objects.js";

let close: (() => Promise<void>) | undefined;

accountRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			accounts: accountTable,
		});
		close = closeDb;
		return createSqliteRepositories(
			{
				app: db,
				mail: db,
				search: db,
			},
			BETTER_SQLITE3_LIMITS,
			messageObjectsInMemory(),
		).account;
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
