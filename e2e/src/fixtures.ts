/**
 * The one fixture every spec uses: the run's API client and the identifiers
 * global setup established.
 */
import { test as base } from "@playwright/test";
import { ApiClient } from "./api.js";
import { type RunState, readRunState } from "./state.js";

interface Fixtures {
	api: ApiClient;
	run: RunState;
}

export const test = base.extend<Fixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from its destructuring pattern, so this one has to be present and empty.
	run: async ({}, use) => {
		await use(readRunState());
	},
	api: async ({ run }, use) => {
		await use(new ApiClient(run.token));
	},
});

export { expect } from "@playwright/test";
