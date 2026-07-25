/**
 * Creating a folder from the filter rule editor's move destination (PR #282).
 * The editor's "Move matches to" select carries a "＋ New folder…" option that
 * reveals a name field; creating there makes the new folder the rule's
 * destination.
 *
 * A standing filter is seeded and opened in Settings › Filters — the same
 * surface organize-standing-filter.spec.ts drives — then re-pointed at a folder
 * created from within the editor. The proof is server-side on the filter: after
 * saving, the account's filter names the newly-created folder as its move
 * target, where before it named the inbox.
 *
 * The live match count comes from `POST /organize/preview`, which the e2e lane
 * cannot answer for real (the vector index is deliberately not built here — see
 * organize-standing-filter.spec.ts). It is stubbed so the commit gate settles,
 * exactly as the organize specs do; the folder create and the filter action
 * update it gates are both real backend calls.
 */
import type { Page } from "@playwright/test";
import type { Filter } from "../src/api.js";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { readRunState } from "../src/state.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const FILTER_NAME = `E2E RuleFolder ${STAMP}`;
const FOLDER_NAME = `E2E Rule Dest ${STAMP}`;

const seededFilters: string[] = [];

const stubPreview = async (page: Page): Promise<void> => {
	await page.route(/\/organize\/preview$/, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ matchedCount: 0, messageIds: [] }),
		});
	});
};

test.describe("Create folder from the rule editor", () => {
	test.use({ viewport: DESKTOP });

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		const live = await api.listFilters(run.accountId);
		const ours = new Set(seededFilters);
		await Promise.all(
			live
				.filter((f) => ours.has(f.filterId))
				.map((f) => api.deleteFilter(run.accountId, f.filterId)),
		);
		const boxes = await api.listMailboxes(run.accountId);
		await Promise.all(
			boxes
				.filter((b) => b.fullPath === FOLDER_NAME)
				.map((b) => api.deleteMailbox(run.accountId, b.mailboxId)),
		);
	});

	test("the editor's New folder option becomes the rule's move destination", async ({
		page,
		api,
		run,
	}) => {
		test.setTimeout(120_000);
		const filter = await api.createFilter(run.accountId, {
			name: FILTER_NAME,
			scope: "Standing",
			literalClauses: [{ field: "From", value: `${STAMP}@example.com` }],
			actionMailboxId: run.inboxId,
		});
		seededFilters.push(filter.filterId);

		await stubPreview(page);
		await page.goto("/settings/filters");

		await page
			.getByRole("button", { name: `Edit filter ${FILTER_NAME}` })
			.click();

		const destination = page.getByRole("combobox", {
			name: "Destination folder",
		});
		await expect(destination).toBeVisible({ timeout: 20_000 });
		await destination.selectOption({ label: "＋ New folder…" });

		const newFolderField = page.getByRole("textbox", {
			name: "New folder name",
		});
		await expect(newFolderField).toBeVisible({ timeout: 10_000 });
		await newFolderField.fill(FOLDER_NAME);
		await page.getByRole("button", { name: "Create folder" }).click();

		// The created folder becomes the selected destination in the editor.
		const created = await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((b) => b.fullPath === FOLDER_NAME),
			{ timeoutMs: 30_000, what: `the folder "${FOLDER_NAME}" to be created` },
		);
		const folder = created.find((b) => b.fullPath === FOLDER_NAME);
		if (!folder) throw new Error("unreachable: folder matched but not found");
		await expect(destination).toHaveValue(folder.mailboxId, {
			timeout: 10_000,
		});

		await page.getByRole("button", { name: "Save rule" }).click();

		// Server truth: the filter now moves matches into the new folder.
		const filters = await waitFor(
			() => api.listFilters(run.accountId),
			(list: Filter[]) =>
				list.some(
					(f) =>
						f.filterId === filter.filterId &&
						f.actionMailboxId === folder.mailboxId,
				),
			{ timeoutMs: 20_000, what: "the filter to point at the new folder" },
		);
		const saved = filters.find((f) => f.filterId === filter.filterId);
		expect(saved?.actionMailboxId).toBe(folder.mailboxId);
		expect(saved?.actionMailboxId).not.toBe(run.inboxId);
	});
});
