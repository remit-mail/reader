/**
 * Issue #703: with a message open, Compose did nothing until typing in search
 * made the window appear and take the caret.
 */
import { expect, test } from "../src/fixtures.js";

test.describe("Compose over an open message", () => {
	test.setTimeout(120_000);

	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		const sidebar = page.getByRole("navigation", {
			name: "Mailboxes",
			exact: true,
		});
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await sidebar.getByRole("link", { name: /inbox/i }).click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		await page.locator("a[href*='selectedMessageId']").first().click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 30_000 });
	});

	test("the compose surface opens, takes the caret, and leaves search alone", async ({
		page,
	}) => {
		const search = page.getByRole("textbox", { name: "Search mail" });
		await search.click();
		await expect(search).toBeFocused();

		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const recipients = page.getByPlaceholder("Recipients");
		await expect(recipients).toBeVisible({ timeout: 30_000 });
		await expect(recipients).toBeFocused();

		// What is typed next goes to the message being written, not to the field
		// the caret started in.
		await page.keyboard.type("ada@remit.test");
		await expect(recipients).toHaveValue("ada@remit.test");
		await expect(search).toHaveValue("");

		// The pane shows one thing, and the URL says the same: the thread is closed
		// rather than sitting behind the surface waiting to reappear.
		await expect(page.getByRole("article")).toBeHidden();
		await page.waitForURL((url) => !url.search.includes("selectedMessageId"));
	});

	test("the c shortcut opens it from the open message too", async ({
		page,
	}) => {
		await page.getByRole("article").click({ position: { x: 4, y: 4 } });
		await page.keyboard.press("c");

		const recipients = page.getByPlaceholder("Recipients");
		await expect(recipients).toBeVisible({ timeout: 30_000 });
		await expect(recipients).toBeFocused();
	});
});
