import { expect, test } from "./fixtures/account-setup.js";

/**
 * Keyboard triage layer (#429). Verifies the 2-state focus model: j/k move a
 * roving focus cursor WITHOUT opening, Enter opens the focused thread, and the
 * pre-existing click-to-open path still works alongside it. Also checks the `?`
 * help overlay and the input-guard (shortcuts inert while typing in search).
 */
test.describe("Keyboard triage", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("click-to-open still works (smoke contract preserved)", async ({
		page,
	}) => {
		const firstRow = page.locator("a[href*='selectedMessageId']").first();
		await firstRow.click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });
	});

	test("j moves focus without opening; Enter opens the focused thread", async ({
		page,
	}) => {
		// Sanity: no thread open yet.
		expect(page.url()).not.toMatch(/selectedMessageId=/);

		// Move the roving focus cursor down. This must NOT open a thread — the
		// URL stays free of selectedMessageId (focus ≠ open).
		await page.keyboard.press("j");
		await page.waitForTimeout(150);
		expect(page.url()).not.toMatch(/selectedMessageId=/);

		// j again, still no open.
		await page.keyboard.press("j");
		await page.waitForTimeout(150);
		expect(page.url()).not.toMatch(/selectedMessageId=/);

		// Enter opens the focused row in the reading pane.
		await page.keyboard.press("Enter");
		await page.waitForURL(/selectedMessageId=/, { timeout: 10_000 });
		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });
	});

	test("? opens the keyboard shortcuts overlay; Esc closes it", async ({
		page,
	}) => {
		await page.keyboard.press("?");
		const dialog = page.getByRole("dialog", { name: /keyboard shortcuts/i });
		await expect(dialog).toBeVisible({ timeout: 5_000 });
		// The overlay renders the real key map. The archive verb was removed
		// (Remit is IMAP-backed — move-to-folder is the equivalent), so it must
		// no longer list "Archive"; real bindings like Reply still appear.
		await expect(dialog.getByText("Archive", { exact: false })).toHaveCount(0);
		await expect(
			dialog.getByText("Reply", { exact: false }).first(),
		).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden({ timeout: 5_000 });
	});

	test("shortcuts are inert while typing in the search field", async ({
		page,
	}) => {
		const search = page.locator("#mail-search").first();
		await search.click();
		// Typing 'j' into search must filter, not move focus or open a thread.
		await search.fill("j");
		await page.waitForTimeout(150);
		expect(page.url()).not.toMatch(/selectedMessageId=/);
		// The help overlay must NOT open from '?' typed into the field.
		await search.press("?");
		await expect(
			page.getByRole("dialog", { name: /keyboard shortcuts/i }),
		).toBeHidden();
	});

	test("Esc in the search field clears the query without closing the open thread", async ({
		page,
	}) => {
		// Open a thread first.
		await page.locator("a[href*='selectedMessageId']").first().click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });

		// Type into search, then press Esc. The field owns Esc (clears the
		// query); the triage layer must stay inert so it does NOT also fire
		// back/goBack and close the thread — one keypress, one effect (#489).
		const search = page.locator("#mail-search").first();
		await search.click();
		await search.fill("zzz");
		await search.press("Escape");
		await page.waitForTimeout(150);

		// Query cleared…
		await expect(search).toHaveValue("");
		// …and the thread is still open.
		expect(page.url()).toMatch(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible();
	});
});
