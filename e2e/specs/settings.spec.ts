/**
 * Settings on a desktop browser (#57). The screen is built from a nav rail, a
 * content column and a tips rail that only exist above the `lg` breakpoint, and
 * from a slide-over that is mounted at all times and pushed off-canvas when
 * closed. Both depend on utility classes surviving into the shipped stylesheet,
 * which a unit test cannot observe — so this asserts the laid-out result in a
 * real browser against a real build: the desktop layout is the one on screen,
 * the content column scrolls, and adding an account is reachable.
 */
import type { Locator } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { readRunState } from "../src/state.js";

const DESKTOP = { width: 1512, height: 864 };

/**
 * Whether the element is the one a click at its own centre would land on.
 *
 * `toBeVisible` is not enough for this bug: the elements it checks were painted
 * and had size the whole time — they were simply underneath a slide-over that
 * covered the viewport. Only a hit test distinguishes rendered from reachable.
 */
const isOnTop = (locator: Locator): Promise<boolean> =>
	locator.evaluate((element) => {
		const { x, y, width, height } = element.getBoundingClientRect();
		const hit = document.elementFromPoint(x + width / 2, y + height / 2);
		if (!hit) return false;
		return element.contains(hit) || hit.contains(element);
	});

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

		// Nothing overlays the screen.
		await expect
			.poll(() => isOnTop(page.getByRole("button", { name: "Add account" })))
			.toBe(true);
	});

	test("the content column scrolls to the bottom of the page", async ({
		page,
	}) => {
		await page.goto("/settings/accounts");
		await expect(page.getByRole("button", { name: "Add account" })).toBeVisible(
			{ timeout: 30_000 },
		);

		// The danger zone sits below the accounts list — the part of the page a
		// non-scrolling settings screen makes unreachable.
		const dangerZone = page.getByRole("button", {
			name: /delete your remit account/i,
		});
		await dangerZone.scrollIntoViewIfNeeded();
		await expect.poll(() => isOnTop(dangerZone)).toBe(true);

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

	test("the Filters screen is reachable and lists the account's filters", async ({
		api,
		page,
		run,
	}) => {
		const filter = await api.createFilter(run.accountId, {
			name: "e2e settings filter",
			scope: "Standing",
			literalClauses: [{ field: "Subject", value: "newsletter" }],
			actionMailboxId: run.inboxId,
		});

		try {
			await page.goto("/settings/accounts");
			await expect(
				page.getByRole("button", { name: "Back to mail" }),
			).toBeVisible({ timeout: 30_000 });

			// Filters is one of the settings nav destinations, not a separate area.
			await page.getByRole("button", { name: "Filters", exact: true }).click();
			await expect(
				page.getByRole("heading", { name: "Filters", exact: true }),
			).toBeVisible({ timeout: 10_000 });

			await expect(
				page.getByRole("listitem").filter({ hasText: "e2e settings filter" }),
			).toBeVisible({ timeout: 20_000 });
		} finally {
			await new ApiClient(readRunState().token).deleteFilter(
				run.accountId,
				filter.filterId,
			);
		}
	});

	test("the account edit panel opens over the screen and closes off it", async ({
		page,
	}) => {
		await page.goto("/settings/accounts");

		const manage = page.getByRole("button", { name: "Manage" }).first();
		await expect(manage).toBeVisible({ timeout: 30_000 });

		// Closed: the panel is mounted but must sit entirely off-canvas and out
		// of the accessibility tree, leaving the screen behind it clickable.
		await expect(
			page.getByRole("heading", { name: "Edit Account" }),
		).toBeHidden();
		await expect.poll(() => isOnTop(manage)).toBe(true);

		await manage.click();
		const panelTitle = page.getByRole("heading", { name: "Edit Account" });
		await expect(panelTitle).toBeVisible({ timeout: 10_000 });
		await expect.poll(() => isOnTop(panelTitle)).toBe(true);

		await page.getByRole("button", { name: "Close", exact: true }).click();
		await expect(panelTitle).toBeHidden();
		// Back off-canvas: the accounts list takes clicks again.
		await expect.poll(() => isOnTop(manage)).toBe(true);
	});
});
