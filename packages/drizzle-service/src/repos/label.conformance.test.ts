import { labelRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { createTestDb, randomId } from "../test-db.js";
import { LabelRepo } from "./label.js";

let close: (() => Promise<void>) | undefined;

labelRepositoryConformance({
	async createRepository() {
		const { db, close: closeDb } = await createTestDb();
		close = closeDb;
		return new LabelRepo(db as never);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
