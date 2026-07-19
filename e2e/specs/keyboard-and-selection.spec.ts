/**
 * Keyboard navigation and multi-select over the message list (#43, #48).
 *
 * Both bugs were about reachability rather than about the underlying operations:
 * the cursor existed but never took DOM focus, a global Enter binding cancelled
 * the activation of whatever control the user had tabbed to, and the selection
 * the bulk-action toolbar reads could not be built with the mouse. So these
 * assertions are all about what a keyboard and a modifier-click can reach.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/** The message id of whatever row currently holds DOM focus, if any. */
const focusedRowId = (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return null;
		return (
			active.closest("[data-message-row]")?.getAttribute("data-message-id") ??
			null
		);
	});

const rowId = (page: Page, index: number): Promise<string> =>
	rows(page).nth(index).getAttribute("data-message-id") as Promise<string>;

const sidebar = (page: Page): Locator =>
	page.getByRole("navigation", { name: "Mailboxes", exact: true });

test.beforeEach(async ({ page, run }) => {
	await page.goto("/mail");
	await expect(sidebar(page)).toBeVisible({ timeout: 20_000 });
	await sidebar(page).getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
		timeout: 30_000,
	});
});

test.describe("Keyboard navigation", () => {
	test("j and k move the cursor, and the browser's focus follows it", async ({
		page,
	}) => {
		const [first, second] = [await rowId(page, 0), await rowId(page, 1)];

		await page.keyboard.press("j");
		expect(await focusedRowId(page)).toBe(first);

		await page.keyboard.press("j");
		expect(await focusedRowId(page)).toBe(second);

		await page.keyboard.press("k");
		expect(await focusedRowId(page)).toBe(first);
	});

	test("the arrow keys move the cursor too", async ({ page }) => {
		const [first, second] = [await rowId(page, 0), await rowId(page, 1)];

		await page.keyboard.press("ArrowDown");
		expect(await focusedRowId(page)).toBe(first);

		await page.keyboard.press("ArrowDown");
		expect(await focusedRowId(page)).toBe(second);

		await page.keyboard.press("ArrowUp");
		expect(await focusedRowId(page)).toBe(first);
	});

	test("Enter opens the message the cursor is on", async ({ page }) => {
		await page.keyboard.press("j");
		await page.keyboard.press("j");
		const focused = await focusedRowId(page);

		await page.keyboard.press("Enter");

		await page.waitForURL(/selectedMessageId=/);
		expect(new URL(page.url()).searchParams.get("selectedMessageId")).toBe(
			focused,
		);
	});

	test("Enter activates a focused control instead of being swallowed", async ({
		page,
	}) => {
		// The #43 regression in its plainest form: tab to something, press Enter,
		// nothing happens — a global Enter binding had cancelled every control's
		// default action for as long as the list was mounted.
		const sent = sidebar(page).getByRole("link", { name: /sent/i });
		await sent.focus();
		const before = page.url();

		await page.keyboard.press("Enter");

		await page.waitForURL((url) => url.href !== before, { timeout: 10_000 });
	});

	test("Tab reaches the message list from the side panel", async ({ page }) => {
		// One tab stop for the whole list (roving tabindex), so Tab crosses into
		// it rather than walking every row.
		await expect(page.locator('[data-message-row][tabindex="0"]')).toHaveCount(
			1,
		);

		await sidebar(page).getByRole("link", { name: /inbox/i }).focus();

		for (let i = 0; i < 20; i++) {
			if ((await focusedRowId(page)) !== null) break;
			await page.keyboard.press("Tab");
		}

		expect(await focusedRowId(page)).not.toBeNull();
	});
});

test.describe("Multi-select", () => {
	const selectionCount = (page: Page): Locator =>
		page.getByText(/\d+ messages? selected/);

	test("shift-click selects the range between two rows", async ({ page }) => {
		await rows(page).nth(0).click();
		await page.waitForURL(/selectedMessageId=/);

		await rows(page)
			.nth(2)
			.click({ modifiers: ["Shift"] });

		await expect(selectionCount(page)).toHaveText("3 messages selected");
	});

	test("shift-click selects rather than opening a second window", async ({
		page,
		context,
	}) => {
		// The router leaves a modified click to the browser, which for an anchor
		// means shift opens a new window and cmd a new tab — the row has to claim
		// the click itself.
		await rows(page).nth(0).click();
		await page.waitForURL(/selectedMessageId=/);
		const opened = page.url();

		await rows(page)
			.nth(2)
			.click({ modifiers: ["Shift"] });

		expect(context.pages()).toHaveLength(1);
		expect(page.url()).toBe(opened);
	});

	test("cmd/ctrl-click adds and removes single rows", async ({ page }) => {
		await rows(page).nth(0).click();
		await page.waitForURL(/selectedMessageId=/);

		await rows(page)
			.nth(1)
			.click({ modifiers: ["ControlOrMeta"] });
		await expect(selectionCount(page)).toHaveText("1 message selected");

		await rows(page)
			.nth(2)
			.click({ modifiers: ["ControlOrMeta"] });
		await expect(selectionCount(page)).toHaveText("2 messages selected");

		await rows(page)
			.nth(2)
			.click({ modifiers: ["ControlOrMeta"] });
		await expect(selectionCount(page)).toHaveText("1 message selected");
	});

	test("a selection offers the bulk actions", async ({ page }) => {
		await rows(page).nth(0).click();
		await page.waitForURL(/selectedMessageId=/);
		await rows(page)
			.nth(1)
			.click({ modifiers: ["Shift"] });

		await expect(selectionCount(page)).toHaveText("2 messages selected");
		await expect(
			page.getByRole("button", { name: "Delete selected messages" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Clear selection" }),
		).toBeVisible();
	});

	test("the keyboard builds the same selection", async ({ page }) => {
		await page.keyboard.press("j");
		await page.keyboard.press("x");
		await expect(selectionCount(page)).toHaveText("1 message selected");

		await page.keyboard.press("Shift+ArrowDown");
		await expect(selectionCount(page)).toHaveText("2 messages selected");
	});

	test("Escape clears the selection", async ({ page }) => {
		await rows(page).nth(0).click();
		await page.waitForURL(/selectedMessageId=/);
		await rows(page)
			.nth(2)
			.click({ modifiers: ["Shift"] });
		await expect(selectionCount(page)).toBeVisible();

		await page.keyboard.press("Escape");

		await expect(selectionCount(page)).toBeHidden();
	});
});
