/**
 * The back button pops one wizard step (#482, epic #477 clause 1.6).
 *
 * The step is a validated `wizard` search param on /mail, so TanStack Router
 * owns the entries and one is pushed per step reached. What this pins is the
 * count: five steps forward is five steps back, and the sixth back leaves the
 * wizard on the mail list with no `wizard` key in the URL. Raw `pushState`
 * entries satisfy the first few and desync the router on the last, which is why
 * the count is asserted through the browser's own back button rather than the
 * header arrow.
 *
 * The wizard is walked with rows ticked, because a live selection is what arms
 * the blocker that turns the back gesture into "leave selection". While the
 * wizard is open that blocker stands down, so every one of these backs is a
 * step and the selection is still there on the way out. The walk goes through
 * the properties door, since it ends on a standing rule and the ticked rows
 * carry no predicate one could keep matching on (#1193).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE });

const rows = (page: Page): Locator => page.locator("[data-message-row]");

const selectionBar = (page: Page): Locator =>
	page.locator("[data-selection-count]");

const stepRail = (page: Page): Locator => page.getByText(/^Step \d+ of \d+ · /);

const continueButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Continue" });

/** In selection mode a row's leading slot is a "Select/Deselect message" button. */
const rowToggle = (row: Locator): Locator =>
	row.getByRole("button", { name: /^(Select|Deselect) message$/ });

/** A long press with real pointer events — the input the row's 500ms timer listens for. */
const longPress = async (page: Page, row: Locator): Promise<void> => {
	const box = await row.boundingBox();
	if (!box) throw new Error("row has no bounding box to long-press");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(650);
	await page.mouse.up();
};

const openInbox = async (page: Page, inboxId: string): Promise<string> => {
	await page.goto(`/mail/${inboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
	return `/mail/${inboxId}`;
};

test.describe("Selection wizard history", () => {
	test("the browser back button pops exactly one step, and the last leaves", async ({
		page,
		run,
	}) => {
		const mailbox = await openInbox(page, run.inboxId);

		// A document that loads straight into a step is re-rooted on a step-free
		// entry, so the wizard always has something to rewind to.
		await page.goto(`${mailbox}?wizard=match`);
		await expect(stepRail(page)).toHaveText(/^Step 1 of 5 · Apply to$/, {
			timeout: 20_000,
		});

		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`${mailbox}$`));
		await expect(rows(page).first()).toBeVisible();

		await longPress(page, rows(page).first());
		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionBar(page)).toHaveText("2 messages selected");
		await expect(page).toHaveURL(new RegExp(`${mailbox}$`));

		await page.goForward();
		await expect(stepRail(page)).toHaveText(/^Step 1 of 5 · Apply to$/);

		// The door is the first branching answer, and it adds the editor step
		// after the step it is given on.
		await page.getByRole("button", { name: "Its properties" }).click();
		await expect(stepRail(page)).toHaveText(/^Step 1 of 6 · Apply to$/);

		await continueButton(page).click();
		await expect(stepRail(page)).toHaveText(/^Step 2 of 6 · Properties$/);
		await expect(page).toHaveURL(/[?&]wizard=properties/);

		await continueButton(page).click();
		await expect(stepRail(page)).toHaveText(/^Step 3 of 6 · Folder$/);
		await expect(page).toHaveURL(/[?&]wizard=folder/);

		// Archive is a standard destination on this account. A rule with nowhere
		// to file has nothing to commit, so the step is answered before Continue.
		await page.getByRole("treeitem", { name: "Move to Archive" }).click();
		await continueButton(page).click();
		await expect(stepRail(page)).toHaveText(/^Step 4 of 6 · Rule$/);
		await expect(page).toHaveURL(/[?&]wizard=rule/);

		// The scope is the second branching answer, and it adds the naming step
		// after the step it is given on — so the entries already pushed keep
		// pointing at the steps they were pushed for.
		await page.getByText("Keep doing this", { exact: true }).click();
		await expect(stepRail(page)).toHaveText(/^Step 4 of 7 · Rule$/);

		await continueButton(page).click();
		await expect(stepRail(page)).toHaveText(/^Step 5 of 7 · Name$/);
		await expect(page).toHaveURL(/[?&]wizard=name/);

		await page.getByLabel("Rule name").fill("Wizard history");
		await continueButton(page).click();
		await expect(stepRail(page)).toHaveText(/^Step 6 of 7 · Review$/);
		await expect(page).toHaveURL(/[?&]wizard=review/);

		await page.goBack();
		await expect(stepRail(page)).toHaveText(/^Step 5 of 7 · Name$/);

		await page.goBack();
		await expect(stepRail(page)).toHaveText(/^Step 4 of 7 · Rule$/);

		await page.goBack();
		await expect(stepRail(page)).toHaveText(/^Step 3 of 7 · Folder$/);

		await page.goBack();
		await expect(stepRail(page)).toHaveText(/^Step 2 of 7 · Properties$/);

		await page.goBack();
		await expect(stepRail(page)).toHaveText(/^Step 1 of 7 · Apply to$/);
		await expect(page).toHaveURL(/[?&]wizard=match/);

		await page.goBack();
		await expect(rows(page).first()).toBeVisible();
		await expect(stepRail(page)).toHaveCount(0);
		// The back that left the wizard was not eaten by the selection blocker.
		await expect(selectionBar(page)).toHaveText("2 messages selected");

		const search = await page.evaluate(() => window.location.search);
		expect(search).not.toContain("wizard");
		expect(new URL(page.url()).pathname).toBe(mailbox);
	});

	test("a step the wizard cannot be on is not an error screen", async ({
		page,
		run,
	}) => {
		const mailbox = await openInbox(page, run.inboxId);

		await page.goto(`${mailbox}?wizard=nope`);
		await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
		await expect(stepRail(page)).toHaveCount(0);
	});
});
