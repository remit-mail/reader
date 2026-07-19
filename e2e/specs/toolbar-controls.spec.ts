/**
 * The reading-pane toolbar's control set is fixed (#52). Buttons do not enter
 * and leave the bar as the view or the selection changes; a button that cannot
 * act right now is disabled and still there.
 *
 * The daily brief is the view that regressed: it never rendered the (i) button
 * at all, so it is asserted here alongside a mailbox to show the two views
 * agree.
 */
import { expect, test } from "../src/fixtures.js";

// Wide enough for the intelligence rail (≥1280px), so "disabled" means the
// selection is missing rather than the window being too narrow.
test.use({ viewport: { width: 1440, height: 900 } });

const infoButton = "Show intelligence sidebar";

test.describe("Reading-pane toolbar", () => {
	test("the daily brief offers the info button with nothing selected, disabled", async ({
		page,
	}) => {
		await page.goto("/mail");

		const info = page.getByRole("button", { name: infoButton });
		await expect(info).toBeVisible({ timeout: 20_000 });
		await expect(info).toBeDisabled();
	});

	test("opening a message from the daily brief enables the info button and its panel", async ({
		page,
	}) => {
		await page.goto("/mail");

		const info = page.getByRole("button", { name: infoButton });
		await expect(info).toBeVisible({ timeout: 20_000 });

		await page
			.locator("a[href*='selectedMessageId']")
			.first()
			.click({ timeout: 30_000 });
		await page.waitForURL(/selectedMessageId=/);

		await expect(info).toBeEnabled({ timeout: 15_000 });
		await info.click();
		await expect(
			page.getByRole("button", { name: "Hide intelligence sidebar" }),
		).toBeVisible();
	});

	test("a mailbox offers the info button with nothing selected, disabled", async ({
		page,
	}) => {
		await page.goto("/mail");
		const sidebar = page.getByRole("navigation", {
			name: "Mailboxes",
			exact: true,
		});
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await sidebar.getByRole("link", { name: /inbox/i }).click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		const info = page.getByRole("button", { name: infoButton });
		await expect(info).toBeVisible({ timeout: 20_000 });
		await expect(info).toBeDisabled();
	});
});
