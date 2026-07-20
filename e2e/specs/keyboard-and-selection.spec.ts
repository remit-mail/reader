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
import { appendMessages } from "../src/imap.js";

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/**
 * The message id of the row that holds DOM focus. Deliberately exact: a control
 * *inside* a row is not the row. Resolving this with `closest()` would report a
 * focused per-row checkbox as a focused row, and hide the very thing the
 * roving-tabindex assertions are here to check.
 */
const focusedRowId = (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return null;
		if (!active.hasAttribute("data-message-row")) return null;
		return active.getAttribute("data-message-id");
	});

/** A description of what holds focus, for failure messages. */
const focusedDescription = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return "nothing";
		const inRow = active.closest("[data-message-row]") !== null;
		const label = active.getAttribute("aria-label") ?? "";
		return `${active.tagName.toLowerCase()}${label ? `[${label}]` : ""}${
			inRow ? " (inside a row)" : ""
		}`;
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

		expect(
			await focusedRowId(page),
			`Tab never landed on a row; focus rested on ${await focusedDescription(page)}`,
		).not.toBeNull();
	});

	test("Tab never stops on a control inside a row", async ({ page }) => {
		// Each row carries a select checkbox that is invisible until hover. Left in
		// the tab order it makes the list dozens of tab stops, most of them on
		// something the user cannot see — and the "exactly one tab stop" claim
		// above would still pass, because a focused checkbox sits within a row.
		await expect(
			page.locator("[data-message-row] button:not([tabindex='-1'])"),
		).toHaveCount(0);

		await sidebar(page).getByRole("link", { name: /inbox/i }).focus();

		// Walk far enough to cross the whole list. Every stop is either outside the
		// rows entirely or a row element itself — never a control within one.
		for (let i = 0; i < 25; i++) {
			await page.keyboard.press("Tab");
			const stop = await page.evaluate(() => {
				const active = document.activeElement;
				if (!(active instanceof HTMLElement)) return "none";
				if (active.hasAttribute("data-message-row")) return "row";
				return active.closest("[data-message-row]") ? "inside-row" : "outside";
			});
			expect(stop, `tab stop ${i} landed inside a row`).not.toBe("inside-row");
		}
	});

	test("Home and End jump to the ends of the list", async ({ page, run }) => {
		const last = run.seededSubjects.length - 1;

		await page.keyboard.press("End");
		expect(await focusedRowId(page)).toBe(await rowId(page, last));

		await page.keyboard.press("Home");
		expect(await focusedRowId(page)).toBe(await rowId(page, 0));
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

	test("Space toggles the row under the cursor", async ({ page }) => {
		await page.keyboard.press("j");
		await page.keyboard.press(" ");
		await expect(selectionCount(page)).toHaveText("1 message selected");

		await page.keyboard.press(" ");
		await expect(selectionCount(page)).toBeHidden();
	});

	test("cmd/ctrl+A selects every loaded row", async ({ page, run }) => {
		await page.keyboard.press("ControlOrMeta+a");

		await expect(selectionCount(page)).toHaveText(
			`${run.seededSubjects.length} messages selected`,
		);
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

test.describe("Delete confirmation", () => {
	const confirmation = (page: Page): Locator =>
		page.getByRole("dialog", { name: /trash/i });

	test("Delete asks before it trashes anything", async ({ page, run }) => {
		await page.keyboard.press("j");
		await page.keyboard.press("Delete");

		await expect(confirmation(page)).toBeVisible();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
	});

	test("a second Delete does not trash the message behind the dialog", async ({
		page,
		run,
	}) => {
		// The keypress that opens a confirmation must not also be able to answer
		// it. Pressing Delete again used to fall through to an unconfirmed delete
		// and move the message to Trash with the dialog still on screen.
		await page.keyboard.press("j");
		await page.keyboard.press("Delete");
		await expect(confirmation(page)).toBeVisible();

		await page.keyboard.press("Delete");
		await page.keyboard.press("Delete");

		await expect(confirmation(page)).toBeVisible();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
	});

	test("no shortcut acts on the list while the confirmation is open", async ({
		page,
		run,
	}) => {
		await page.keyboard.press("j");
		await page.keyboard.press("Delete");
		await expect(confirmation(page)).toBeVisible();

		await page.keyboard.press("j");
		await page.keyboard.press("x");
		await page.keyboard.press("ControlOrMeta+a");

		await expect(page.getByText(/\d+ messages? selected/)).toBeHidden();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);

		// Cancelling hands the keyboard back, still pointed at the same row.
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(confirmation(page)).toBeHidden();
		await page.keyboard.press("x");
		await expect(page.getByText("1 message selected")).toBeVisible();
	});

	test("confirming is what deletes", async ({ page, api, run }) => {
		// Deletes a message this test appends rather than one of the seeded three,
		// so the inbox is back to the set every other spec expects by the end. The
		// suite runs serially over one shared mailbox.
		const subject = `Delete me ${Date.now()}`;
		await appendMessages(run.imapUser, [{ subject }]);
		await api.triggerSync(run.accountId);

		const withExtra = run.seededSubjects.length + 1;
		await expect(async () => {
			await page.reload();
			await expect(rows(page)).toHaveCount(withExtra, { timeout: 5_000 });
		}).toPass({ timeout: 60_000 });

		await page.getByText(subject, { exact: true }).first().click();
		await page.waitForURL(/selectedMessageId=/);
		await page.keyboard.press("Delete");
		await expect(confirmation(page)).toBeVisible();

		await confirmation(page)
			.getByRole("button", { name: "Move to Trash" })
			.click();

		await expect(confirmation(page)).toBeHidden();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
		await expect(page.getByText(subject, { exact: true })).toBeHidden();
	});
});
