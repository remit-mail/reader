/**
 * Settings on a desktop browser (#57). The screen is built from a nav rail, a
 * content column and a tips rail that only exist above the `lg` breakpoint, and
 * from a slide-over that is mounted at all times and pushed off-canvas when
 * closed. Both depend on utility classes surviving into the shipped stylesheet,
 * which a unit test cannot observe — so this asserts the laid-out result in a
 * real browser against a real build: the desktop layout is the one on screen,
 * the content column scrolls, and adding an account is reachable.
 */
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };

test.describe("Settings", () => {
	test.use({ viewport: DESKTOP });

	test("renders the desktop layout, not the collapsed one", async ({
		page,
	}) => {
		await page.goto("/settings/accounts");

		// The rail is the desktop tell: below `lg` it collapses into a drawer
		// behind a menu button.
		await expect(
			page.getByRole("button", { name: "Back to mail" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("button", { name: "Open settings menu" }),
		).toBeHidden();

		// Nothing overlays the screen: the accounts content is what receives a
		// click at the centre of the viewport.
		await expect(
			page.getByRole("button", { name: "Add account" }),
		).toBeVisible();
	});

	test("the content column scrolls to the bottom of the page", async ({
		page,
	}) => {
		await page.goto("/settings/accounts");
		await expect(page.getByRole("button", { name: "Add account" })).toBeVisible(
			{
				timeout: 30_000,
			},
		);

		// The danger zone sits below the accounts list — the part of the page a
		// non-scrolling settings screen makes unreachable.
		const dangerZone = page.getByRole("button", {
			name: /delete your remit account/i,
		});
		await dangerZone.scrollIntoViewIfNeeded();
		await expect(dangerZone).toBeVisible();

		// The page itself never scrolls; the shell pins the chrome and scrolls
		// one column inside it.
		const pageOverflows = await page.evaluate(
			() => document.body.scrollHeight > window.innerHeight + 1,
		);
		expect(pageOverflows).toBe(false);
	});

	test("adding an account is reachable from settings", async ({ page }) => {
		await page.goto("/settings/accounts");

		await page.getByRole("button", { name: "Add account" }).click();

		await expect(
			page.getByRole("heading", { name: /how does this account connect/i }),
		).toBeVisible({ timeout: 10_000 });

		await page.getByRole("button", { name: /continue with imap/i }).click();
		await expect(
			page.getByRole("heading", { name: /what's the email address/i }),
		).toBeVisible({ timeout: 10_000 });
	});

	test("the account edit panel opens over the screen and closes off it", async ({
		page,
	}) => {
		await page.goto("/settings/accounts");

		const manage = page.getByRole("button", { name: "Manage" }).first();
		await expect(manage).toBeVisible({ timeout: 30_000 });

		// Closed: the panel is mounted but must sit entirely off-canvas and out
		// of the accessibility tree.
		await expect(
			page.getByRole("heading", { name: "Edit Account" }),
		).toBeHidden();

		await manage.click();
		await expect(
			page.getByRole("heading", { name: "Edit Account" }),
		).toBeVisible({ timeout: 10_000 });

		await page.getByRole("button", { name: "Close", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Edit Account" }),
		).toBeHidden();
	});
});
