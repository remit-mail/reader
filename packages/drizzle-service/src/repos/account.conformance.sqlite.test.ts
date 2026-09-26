import { accountRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { accountTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { AccountRepo } from "./i4-account.js";

let close: (() => Promise<void>) | undefined;

accountRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			accounts: accountTable,
		});
		close = closeDb;
		return new AccountRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
