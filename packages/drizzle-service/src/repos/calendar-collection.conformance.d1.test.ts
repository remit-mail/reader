import { calendarCollectionRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { openD1TestStores } from "../test-d1.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";

let close: (() => Promise<void>) | undefined;

calendarCollectionRepositoryConformance({
	async createRepository() {
		const opened = await openD1TestStores();
		close = opened.close;
		return new CalendarCollectionRepo(opened.stores.app.db);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
