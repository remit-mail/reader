/**
 * Automated organizing (issue #213): a standing filter created by Organize
 * keeps working on future mail, and Settings › Filters is where it is seen and
 * managed.
 *
 * The organize sheet widens a selection with a semantic preview before it
 * commits a filter, and that vector index is deliberately not built on the e2e
 * lane (localhost-e2e-dev.env). So the loop is driven where it is observable:
 * the filters are seeded against the same `POST /accounts/{id}/filters` the
 * sheet ultimately calls, and the Settings › Filters UI is asserted over the
 * result — a standing filter reads Active, a lapsed temporary one reads Expired
 * and is never dropped, and deleting one through the UI removes it.
 *
 * The filters are the only state this spec adds, and they touch nothing the
 * shared inbox-count invariant depends on. Whatever a UI-driven delete does not
 * reach is cleaned up by id in afterAll so no filter leaks into another spec's
 * account.
 */
import type { Filter } from "../src/api.js";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { readRunState } from "../src/state.js";

const DESKTOP = { width: 1512, height: 864 };

const RUN_TAG = `e2e-${Date.now()}`;
const STANDING_NAME = `${RUN_TAG} standing`;
const TEMPORARY_NAME = `${RUN_TAG} temporary`;

const seeded: string[] = [];

test.describe("Automated organizing — standing filters", () => {
	test.use({ viewport: DESKTOP });

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		const live = await api.listFilters(run.accountId);
		const ours = new Set(seeded);
		await Promise.all(
			live
				.filter((filter) => ours.has(filter.filterId))
				.map((filter) => api.deleteFilter(run.accountId, filter.filterId)),
		);
	});

	test("Settings lists standing and lapsed filters and deletes them", async ({
		api,
		page,
		run,
	}) => {
		const standing = await api.createFilter(run.accountId, {
			name: STANDING_NAME,
			scope: "Standing",
			literalClauses: [{ field: "From", value: "travel@example.com" }],
			actionMailboxId: run.inboxId,
		});
		const temporary = await api.createFilter(run.accountId, {
			name: TEMPORARY_NAME,
			scope: "Temporary",
			expiresAt: "2020-01-01T00:00:00+00:00",
			literalClauses: [{ field: "Subject", value: "receipt" }],
			actionMailboxId: run.inboxId,
		});
		seeded.push(standing.filterId, temporary.filterId);

		await page.goto("/settings/filters");

		const standingRow = page
			.getByRole("listitem")
			.filter({ hasText: STANDING_NAME });
		const temporaryRow = page
			.getByRole("listitem")
			.filter({ hasText: TEMPORARY_NAME });

		await expect(standingRow).toBeVisible({ timeout: 30_000 });
		await expect(temporaryRow).toBeVisible();

		// A standing filter runs until deleted; a temporary one past its date
		// stops on its own but stays listed, marked Expired (RFC 034 Decision 1.2).
		await expect(
			standingRow.getByText("Active", { exact: true }),
		).toBeVisible();
		await expect(
			temporaryRow.getByText("Expired", { exact: true }),
		).toBeVisible();

		// Deleting through the UI removes the filter and the list refetches.
		await standingRow
			.getByRole("button", { name: `Delete filter ${STANDING_NAME}` })
			.click();

		await expect(standingRow).toHaveCount(0, { timeout: 20_000 });
		await expect(temporaryRow).toBeVisible();

		// The delete reached the server, not just the optimistic cache.
		const remaining = await waitFor(
			() => api.listFilters(run.accountId),
			(filters: Filter[]) =>
				!filters.some((filter) => filter.filterId === standing.filterId),
			{ timeoutMs: 20_000, what: "the deleted standing filter to be gone" },
		);
		expect(remaining.map((filter) => filter.name)).not.toContain(STANDING_NAME);
	});
});
