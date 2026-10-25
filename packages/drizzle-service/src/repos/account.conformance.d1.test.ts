import { accountRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { composeSqliteRepositories } from "../sqlite-repositories.js";
import { openD1TestStores } from "../test-d1.js";

let close: (() => Promise<void>) | undefined;

accountRepositoryConformance({
	async createRepository() {
		const opened = await openD1TestStores();
		close = opened.close;
		return composeSqliteRepositories(opened.stores).account;
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
