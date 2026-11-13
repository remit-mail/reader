import { accountRepositoryConformance } from "@remit/data-ports/conformance";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { accountTable } from "../schema.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { sharedDatabases } from "../test-sqlite.js";
import { messageObjectsInMemory } from "./message-objects.js";

let close: (() => Promise<void>) | undefined;

accountRepositoryConformance({
	async createRepository() {
		const {
			db,
			immediate,
			close: closeDb,
		} = await createSqliteTestDb({
			accounts: accountTable,
		});
		close = closeDb;
		return createSqliteRepositories(
			sharedDatabases({ db, immediate }),
			NODE_SQLITE_LIMITS,
			messageObjectsInMemory(),
		).account;
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
