import { senderSignerStandingRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { senderSignerStandingTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { SenderSignerStandingRepo } from "./i4-sender-signer-standing.js";

let close: (() => Promise<void>) | undefined;

senderSignerStandingRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			senderSignerStandings: senderSignerStandingTable,
		});
		close = closeDb;
		return new SenderSignerStandingRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
