/**
 * The brief's chips and its search query are one state (#460).
 *
 * The filter caret used to stand down for the duration of a search, which left
 * the attribute chips unreachable exactly when someone was narrowing hardest.
 * They are reachable now because they no longer compete with the search: ticking
 * one writes its term into the query, so what narrows the list is legible in the
 * field, editable there, and gone when the term is deleted.
 *
 * "Unread" is the chip under test because its input is set on the server at
 * APPEND time: one seeded message arrives already `\Seen` and the other does
 * not, so what the chip must hide is decided before the app has seen either.
 *
 * Driven at both widths that keep the brief's own rows. Desktop, where the top
 * bar owns the field and the header keeps its title and caret; and tablet,
 * where the header's own field takes the title's place and the caret rides
 * beside it — a caret that lived only in the title's row would leave the whole
 * tablet width with no way to the chips.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { expectBlockedReason } from "../src/wizard.js";

const DESKTOP = { width: 1512, height: 864 };
const TABLET = { width: 800, height: 1106 };

const briefRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

const searchField = (page: Page): Locator => page.getByLabel("Search mail");

const filterCaret = (page: Page): Locator =>
	page.getByRole("button", { name: "Expand filters" });

const chip = (page: Page, label: string): Locator =>
	page.getByRole("button", { name: label, exact: true });

const makeFilter = (page: Page): Locator =>
	page.getByRole("button", { name: "Make this a filter" });

test.describe("The brief's chips compose into the search query (#460)", () => {
	test.use({ viewport: DESKTOP });

	const tag = `briefchip${Date.now()}`;
	const readSubject = `Brief chip read ${tag}`;
	const unreadSubject = `Brief chip unread ${tag}`;
	const otherSubject = `Brief chip elsewhere ${Date.now()}`;

	test.beforeEach(async ({ run, api }) => {
		await appendMessages(run.imapUser, [
			{ subject: readSubject, flags: ["\\Seen"] },
			{ subject: unreadSubject },
			{ subject: otherSubject },
		]);
		await api.triggerSync(run.accountId);
	});

	test.afterEach(async ({ api, run }) => {
		for (const needle of [tag, otherSubject]) {
			const leftover = await api.searchMatchingMessageIds(run.inboxId, needle);
			if (leftover.length > 0) await api.deleteMessages(leftover);
		}
	});

	test("a chip ticked mid-search is a term of the query, and the term is the chip", async ({
		page,
	}) => {
		await page.goto("/mail");
		await expect(async () => {
			await page.reload();
			for (const subject of [readSubject, unreadSubject, otherSubject]) {
				await expect(briefRow(page, subject)).toBeVisible({ timeout: 5_000 });
			}
		}).toPass({ timeout: 60_000 });

		await searchField(page).fill(tag);
		await expect(briefRow(page, otherSubject)).toHaveCount(0);
		await expect(briefRow(page, readSubject)).toBeVisible();
		await expect(briefRow(page, unreadSubject)).toBeVisible();

		// The caret is still there under a query — the panel it opens is the only
		// route to the chips, and a search is when they are wanted most.
		await expect(filterCaret(page)).toBeVisible();
		await filterCaret(page).click();
		await expect(chip(page, "Unread")).toHaveAttribute("aria-pressed", "false");

		// Ticking writes the term the search field already parses, so the user can
		// read what is narrowing the list rather than infer it.
		await chip(page, "Unread").click();
		await expect(searchField(page)).toHaveValue(`${tag} is:unread`);
		await expect(briefRow(page, unreadSubject)).toBeVisible();
		await expect(briefRow(page, readSubject)).toHaveCount(0);
		await expect(chip(page, "Unread")).toHaveAttribute("aria-pressed", "true");

		// Deleting the term by hand unticks the chip and gives the rows back.
		await searchField(page).fill(tag);
		await expect(chip(page, "Unread")).toHaveAttribute("aria-pressed", "false");
		await expect(briefRow(page, readSubject)).toBeVisible();

		// Typing it by hand ticks the chip: one state, read from both ends.
		await searchField(page).fill(`${tag} is:unread`);
		await expect(chip(page, "Unread")).toHaveAttribute("aria-pressed", "true");
		await expect(briefRow(page, readSubject)).toHaveCount(0);

		// A category is the same bargain, and it flattens the sections as the
		// category pill always has.
		await chip(page, "Newsletters").click();
		await expect(searchField(page)).toHaveValue(
			`${tag} is:unread category:newsletter`,
		);
	});

	test("a query composed only of chips says what is missing from it", async ({
		page,
	}) => {
		await page.goto("/mail");
		await expect(briefRow(page, unreadSubject)).toBeVisible({
			timeout: 60_000,
		});

		await searchField(page).fill(tag);
		await expect(filterCaret(page)).toBeVisible();
		await filterCaret(page).click();
		await chip(page, "Unread").click();
		await expect(searchField(page)).toHaveValue(`${tag} is:unread`);

		// Delete the words and the query is nothing but the chip. There is no
		// clause to build a filter from, and the reason names the facet that is in
		// the way rather than asking for something that was just supplied.
		await searchField(page).fill("is:unread");
		await expect(chip(page, "Unread")).toHaveAttribute("aria-pressed", "true");

		await expect(makeFilter(page)).toBeVisible({ timeout: 20_000 });
		await makeFilter(page).click();
		await expectBlockedReason(
			page,
			"Unread isn't a filter condition — add a sender or words to filter on",
		);
	});
});

test.describe("The brief's chips are reachable at tablet width (#460)", () => {
	test.use({ viewport: TABLET });

	const tag = `brieftablet${Date.now()}`;
	const readSubject = `Brief tablet read ${tag}`;
	const unreadSubject = `Brief tablet unread ${tag}`;

	test.beforeEach(async ({ run, api }) => {
		await appendMessages(run.imapUser, [
			{ subject: readSubject, flags: ["\\Seen"] },
			{ subject: unreadSubject },
		]);
		await api.triggerSync(run.accountId);
	});

	test.afterEach(async ({ api, run }) => {
		const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
		if (leftover.length > 0) await api.deleteMessages(leftover);
	});

	test("the caret rides with the field that took the title's place", async ({
		page,
	}) => {
		await page.goto("/mail");
		await expect(async () => {
			await page.reload();
			for (const subject of [readSubject, unreadSubject]) {
				await expect(briefRow(page, subject)).toBeVisible({ timeout: 5_000 });
			}
		}).toPass({ timeout: 60_000 });

		// Below desktop the header owns the field, and putting it up takes the
		// title row — and everything that was in it — off screen.
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(searchField(page)).toBeVisible();
		await searchField(page).fill(tag);
		await expect(briefRow(page, readSubject)).toBeVisible();

		await expect(filterCaret(page)).toBeVisible();
		await filterCaret(page).click();
		await chip(page, "Unread").click();

		await expect(searchField(page)).toHaveValue(`${tag} is:unread`);
		await expect(briefRow(page, unreadSubject)).toBeVisible();
		await expect(briefRow(page, readSubject)).toHaveCount(0);
	});
});
