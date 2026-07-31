/**
 * The list header survives a search (#480).
 *
 * The header and the selection bar are one surface, and for the mailbox list
 * and Starred that surface is rendered by the list body. Swapping the body for
 * the read-only results panel therefore takes the header with it unless the
 * panel goes where the rows go instead — the pane loses its title, its unread
 * count and its selection bar, and on tablet the field being typed into is
 * destroyed mid-keystroke.
 *
 * Driven at tablet width, where the list header owns the search field itself
 * (`isSinglePaneTier`), so both failures are reachable: both Starred and the
 * mailbox route show the panel while the query is still being typed.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";

const TABLET = { width: 800, height: 1106 };
test.use({ viewport: TABLET });

const listHeader = (page: Page): Locator =>
	page.locator("[data-selection-bar]");

/** The header's field. Located by label, not by role: the completions wiring
 *  makes it a combobox, and the app top bar's copy of the same field a plain
 *  textbox. */
const searchField = (page: Page): Locator => page.getByLabel("Search mail");

const openHeaderSearch = async (page: Page): Promise<void> => {
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(searchField(page)).toBeVisible();
};

test.describe("The list header survives a search", () => {
	test("Starred keeps its header while the results panel is up", async ({
		page,
	}) => {
		// By URL: below desktop the nav is a slide-over, not a standing pane.
		await page.goto("/mail/flagged");
		await expect(listHeader(page)).toBeVisible({ timeout: 30_000 });
		await expect(listHeader(page).getByText("Starred")).toBeVisible();

		await openHeaderSearch(page);
		await searchField(page).fill("zzz");

		// Starred answers a query still being typed with the read-only panel,
		// and it has no header of its own — the pane's one header has to still
		// be there, with the field it owns. (The field takes the title's place
		// while it is up, which is why "Starred" is not asserted again here.)
		await expect(listHeader(page)).toBeVisible();
		await expect(listHeader(page).getByLabel("Search mail")).toBeVisible();
		await expect(searchField(page)).toHaveValue("zzz");
	});

	test("the mailbox header keeps the field it is being typed into", async ({
		page,
		run,
	}) => {
		await page.goto(`/mail/${run.inboxId}`);
		await expect(listHeader(page)).toBeVisible({ timeout: 30_000 });

		await openHeaderSearch(page);
		await searchField(page).click();
		await page.keyboard.type("a");
		// The panel takes over the rows the moment a character lands. A header
		// that goes with them takes the focused field down too, losing the caret
		// and everything typed before the debounce commits.
		await page.keyboard.type("bcdef");

		await expect(searchField(page)).toHaveValue("abcdef");
		await expect(searchField(page)).toBeFocused();
		await expect(listHeader(page)).toBeVisible();
	});
});
