import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures/account-setup.js";

// `path` in `page.screenshot({ path })` resolves relative to the test
// process CWD, which can be either the repo root or the workspace dir
// depending on how the smoke suite is invoked. Pin to an absolute path
// rooted at this spec file so the screenshots always land in the same
// place under `doc/screenshots/`.
const __filename = fileURLToPath(import.meta.url);
const SCREENSHOTS_DIR = resolve(
	dirname(__filename),
	"../../../doc/screenshots/trusted-sender",
);

const openFirstMessage = async (
	page: import("@playwright/test").Page,
): Promise<void> => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
	await expect(sidebar).toBeVisible({ timeout: 15_000 });
	const inbox = sidebar.getByRole("link", { name: /inbox/i });
	await inbox.click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	const messageLink = page.locator("a[href*='selectedMessageId']").first();
	await expect(messageLink).toBeVisible({ timeout: 10_000 });
	await messageLink.click();
	await page.waitForURL(/selectedMessageId=/);

	// Wait for the message body to land (skeleton goes away).
	const article = page.getByRole("article");
	await expect(article).toBeVisible({ timeout: 10_000 });
	await expect(article.locator(".animate-pulse")).toBeHidden({
		timeout: 10_000,
	});
};

test.describe("Trusted sender flag", () => {
	test("toggling trust shows the green checkmark and updates the menu", async ({
		page,
	}) => {
		await openFirstMessage(page);

		// Sanity: no badge before toggle.
		await expect(
			page.getByTestId("trusted-sender-badge").first(),
		).not.toBeVisible();

		// Capture the untrusted baseline.
		await page.screenshot({
			path: `${SCREENSHOTS_DIR}/01-untrusted-baseline.png`,
			fullPage: false,
		});

		// Open the hamburger menu and toggle trust on.
		const article = page.getByRole("article");
		const hamburger = article
			.locator("button:has(svg.lucide-ellipsis-vertical)")
			.first();
		await hamburger.click();
		const trustItem = page
			.getByRole("button", { name: /trusted sender/i })
			.first();
		await expect(trustItem).toBeVisible();

		// Capture the menu in the off state.
		await page.screenshot({
			path: `${SCREENSHOTS_DIR}/02-menu-untrusted.png`,
			fullPage: false,
		});

		await trustItem.click();

		// Optimistic update: badge appears immediately.
		await expect(page.getByTestId("trusted-sender-badge").first()).toBeVisible({
			timeout: 5_000,
		});

		// Click off the menu so the screenshot is clean.
		await page.locator("body").click({ position: { x: 5, y: 5 } });

		await page.screenshot({
			path: `${SCREENSHOTS_DIR}/03-trusted-checkmark.png`,
			fullPage: false,
		});

		// Open the menu again to show the checkmark icon next to the item.
		await hamburger.click();
		await expect(
			page.getByRole("button", { name: /trusted sender/i }).first(),
		).toBeVisible();
		await page.screenshot({
			path: `${SCREENSHOTS_DIR}/04-menu-trusted.png`,
			fullPage: false,
		});

		// Close menu.
		await page.locator("body").click({ position: { x: 5, y: 5 } });

		// Toggle off again to verify revoke path.
		await hamburger.click();
		await page
			.getByRole("button", { name: /trusted sender/i })
			.first()
			.click();
		await expect(
			page.getByTestId("trusted-sender-badge").first(),
		).not.toBeVisible({ timeout: 5_000 });
		await page.locator("body").click({ position: { x: 5, y: 5 } });

		await page.screenshot({
			path: `${SCREENSHOTS_DIR}/05-untrusted-after-revoke.png`,
			fullPage: false,
		});
	});
});
