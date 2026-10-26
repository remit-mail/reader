import { calendarEventIndexRepositoryConformance } from "@remit/data-ports/conformance";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { openD1TestStores } from "../test-d1.js";
import { CalendarEventIndexRepo } from "./calendar-event-index.js";

let close: (() => Promise<void>) | undefined;

calendarEventIndexRepositoryConformance({
	async createRepository() {
		const opened = await openD1TestStores();
		close = opened.close;
		return new CalendarEventIndexRepo(opened.stores.app);
	},
	teardown: async () => {
		await close?.();
	},
	makeId: () => randomId(),
	isNotFoundError: (error) => error instanceof NotFoundError,
});
