import { labelRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { labelTable } from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { LabelRepo } from "./label.js";

let close: (() => Promise<void>) | undefined;

labelRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createSqliteTestDb({
			labels: labelTable,
		});
		close = closeDb;
		return new LabelRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
