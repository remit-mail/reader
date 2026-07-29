/**
 * A search is the wizard's second entry (#484, epic #477 clauses 1.7, 1.8, 3.4).
 *
 * "Make this a filter" opens the same selection wizard the selection bar opens,
 * on the properties step, with the clauses the query converts to and nothing
 * ticked. The query seeds those clauses and nothing else, so this walks the rest
 * of the flow: the folder step, the rule step and the review read exactly as
 * they do for a selection made in the list.
 *
 * What a filter cannot carry is named on the step rather than left unsaid: the
 * folder the search was limited to, and a facet that is no clause, are both
 * stated above the chips. So is the count, which a free-text query has none of —
 * the vector-free matcher will not read message bodies, and an empty sample that
 * claims nothing matches is worse than one that says why it cannot say.
 *
 * Driven on the daily brief, the one view whose scope is nothing — a route that
 * already reads one mailbox answers "which folder" itself, so a typed `in:`
 * stays ordinary words there. Tablet width, where the list header owns the
 * search field, so the field and the affordance are on one surface.
 *
 * Nothing is committed: the walk stops on Review, so the shared inbox and the
 * account's filters are left exactly as they were.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import {
	advanceTo,
	expectBlockedReason,
	expectNoBlockedReason,
	pickFolder,
	wizardContinue,
	wizardStep,
} from "../src/wizard.js";

const TABLET = { width: 800, height: 1106 };
test.use({ viewport: TABLET });

/** Copy owned by `web-client/src/lib/organize/rule-model.ts`. */
const UNCOUNTABLE =
	"Can't count matches — “has the words” reads message bodies, which only a saved rule does.";

const NOTHING_TO_CONVERT = "Add a sender or words to filter on";

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
	test("a scoped, facetted search walks the wizard from its converted clauses", async ({
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

		// A body-text clause has no count and never will, and the sample says so
		// rather than reporting a match of nothing (#477 3.5).
		await expect(page.getByText(UNCOUNTABLE).first()).toBeVisible();

		// Everything past Properties is the ordinary walk.
		await advanceTo(page, "Folder");
		await pickFolder(page, "Archive");
		await advanceTo(page, "Rule");

		// A one-time apply cannot serve a body-text clause, and the scope step is
		// where that is said — not the step that offered the clause (#477 5.2).
		await page.getByText("Just once", { exact: true }).click();
		await wizardContinue(page).click();
		await expectBlockedReason(page, "Applying once can't read message bodies");
		await expect(wizardStep(page)).toHaveText(/· Rule$/);

		// Keeping it means a name, then the review — the same steps in the same
		// order a selection made in the list reaches.
		await page.getByText("Keep doing this", { exact: true }).click();
		await advanceTo(page, "Name");
		await page.getByLabel("Rule name").fill("npm from search");
		await advanceTo(page, "Review");

		await expect(page.getByText(/every message where/)).toBeVisible();
		await expect(page.getByText(UNCOUNTABLE).first()).toBeVisible();

		// Nothing was ticked and nothing was committed: cancelling rewinds the
		// whole walk and lands back on the search.
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(wizardStep(page)).toHaveCount(0);
		await expect(listHeader(page)).toBeVisible();
	});

	test("a facets-only search says what is missing instead of going dead", async ({
		page,
	}) => {
		await openBrief(page);
		await search(page, "is:unread");

		// Nothing disables (#477 1.7): the affordance stays pressable, and the
		// press is what announces the reason — which is why nothing is announced
		// until then.
		await expect(makeFilter(page)).toBeVisible({ timeout: 20_000 });
		await expect(makeFilter(page)).toBeEnabled();
		await expectNoBlockedReason(page, NOTHING_TO_CONVERT);

		await makeFilter(page).click();

		await expectBlockedReason(page, NOTHING_TO_CONVERT);
		await expect(wizardStep(page)).toHaveCount(0);
	});
});
