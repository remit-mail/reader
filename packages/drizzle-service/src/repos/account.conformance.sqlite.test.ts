import { accountRepositoryConformance } from "@remit/data-ports/conformance";
import { syncBatch } from "../batch.js";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { accountTable } from "../schema.js";
import { SearchIndex } from "../search/thread-message-search.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { AccountRepo } from "./i4-account.js";
import { MailboxRepo } from "./i4-mailbox.js";

let close: (() => Promise<void>) | undefined;

accountRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			accounts: accountTable,
		});
		close = closeDb;
		return new AccountRepo(
			db as never,
			new MailboxRepo(
				db as never,
				syncBatch(db as never),
				new SearchIndex(db as never, db as never, syncBatch(db as never)),
			),
		);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
