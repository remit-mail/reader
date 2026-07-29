/**
 * A search is the wizard's second entry (#484, epic #477 clauses 1.7, 1.8, 3.4).
 *
 * "Make this a filter" opens the same selection wizard the selection bar opens,
 * on the properties step, with the clauses the query converts to and nothing
 * ticked. The query seeds those clauses and nothing else — every step after it
 * is the one a selection from the inbox walks.
 *
 * What a filter cannot carry is named on the step rather than left unsaid: the
 * folder the search was limited to, and a facet that is no clause, are both
 * stated above the chips.
 *
 * Driven on the daily brief, the one view whose scope is nothing — a route that
 * already reads one mailbox answers "which folder" itself, so a typed `in:`
 * stays ordinary words there. Tablet width, where the list header owns the
 * search field, so the field and the affordance are on one surface.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { wizardStep } from "../src/wizard.js";

const TABLET = { width: 800, height: 1106 };
test.use({ viewport: TABLET });

const listHeader = (page: Page): Locator =>
	page.locator("[data-selection-bar]");

const searchField = (page: Page): Locator => page.getByLabel("Search mail");

const makeFilter = (page: Page): Locator =>
	page.getByRole("button", { name: "Make this a filter" });

/** Every clause chip on the properties step, by its edit control. */
const clauseChips = (page: Page): Locator =>
	page.getByRole("button", { name: /^Edit .+ clause$/ });

const openBrief = async (page: Page): Promise<void> => {
	await page.goto("/mail");
	await expect(listHeader(page)).toBeVisible({ timeout: 30_000 });
};

const search = async (page: Page, query: string): Promise<void> => {
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(searchField(page)).toBeVisible();
	await searchField(page).fill(query);
};

test.describe("Make this a filter", () => {
	test("a scoped, facetted search opens the wizard on the clauses it converts to", async ({
		page,
	}) => {
		await openBrief(page);
		await search(page, "in:Archive is:unread npm");

		// The folder name resolves against the loaded mailboxes, which is what
		// makes `in:Archive` a facet rather than two more words to match on.
		await expect(makeFilter(page)).toBeVisible({ timeout: 20_000 });
		await makeFilter(page).click();

		// Organize from a search: properties, folder, rule, review, run. The match
		// door is dropped — the query has already said what this applies to.
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Properties$/, {
			timeout: 20_000,
		});

		// The free text is the whole rule. Neither the folder scope nor the read
		// state is a clause, so neither becomes one.
		await expect(clauseChips(page)).toHaveCount(1);
		await expect(clauseChips(page)).toHaveAttribute(
			"aria-label",
			"Edit Has the words clause",
		);
		await expect(clauseChips(page)).toContainText("npm");

		// Both losses are named, in the words the conversion notice owns.
		await expect(
			page.getByText(/Your search was limited to Archive/),
		).toBeVisible();
		await expect(
			page.getByText(/Unread isn't a filter condition/),
		).toBeVisible();

		// Nothing was ticked, so there is nothing to leave behind: cancelling
		// rewinds the wizard and lands back on the search.
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(wizardStep(page)).toHaveCount(0);
		await expect(listHeader(page)).toBeVisible();
	});

	test("a facets-only search says what is missing instead of going dead", async ({
		page,
	}) => {
		await openBrief(page);
		await search(page, "is:unread");

		// Nothing disables (#477 1.7). The affordance stays pressable, and the
		// press is what puts the reason on screen.
		await expect(makeFilter(page)).toBeVisible({ timeout: 20_000 });
		await expect(makeFilter(page)).toBeEnabled();
		await makeFilter(page).click();

		await expect(
			page
				.getByRole("status")
				.filter({ hasText: "Add a sender or words to filter on" }),
		).toBeVisible();
		await expect(wizardStep(page)).toHaveCount(0);
	});
});
