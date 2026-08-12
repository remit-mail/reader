/**
 * The fragment carries panel visibility (#722).
 *
 * The shortcuts sheet, the nav slide-over and the intelligence rail used to be
 * React state, so what a reader had open was reproducible only by opening it
 * again. Every assertion below therefore reloads: a panel that survives the
 * reload is one the address is genuinely carrying, and a panel the address
 * carries is one a shared link lands on.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { INBOX_LIST, listOnScreen } from "../src/lists.js";
import {
	BRIEF_URL,
	MAILBOX_ROW_LINK,
	MAILBOX_THREAD_URL,
	MAILBOX_URL,
} from "../src/urls.js";

const shortcutsSheet = (page: Page): Locator =>
	page.getByRole("dialog", { name: "Keyboard shortcuts" });

const navSlideOver = (page: Page): Locator =>
	page.getByRole("dialog", { name: "Folders" });

/**
 * The rail itself, not the toolbar's report of it: the control saying "hide"
 * over a pane nobody mounted is the failure this whole route shape is about.
 */
const intelligenceRail = (page: Page): Locator =>
	page.getByRole("complementary").filter({ hasText: "Intelligence" }).first();

const SHOW_RAIL = "Show intelligence sidebar";
const HIDE_RAIL = "Hide intelligence sidebar";

const openMessage = async (page: Page, subject: string): Promise<void> => {
	const row = page.locator(MAILBOX_ROW_LINK).filter({ hasText: subject });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	await page.waitForURL(MAILBOX_THREAD_URL);
	await expect(
		page
			.getByRole("article")
			.getByRole("heading", { name: subject, exact: true }),
	).toBeVisible({ timeout: 15_000 });
};

const openInbox = async (page: Page): Promise<void> => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(MAILBOX_URL);
	await listOnScreen(page, INBOX_LIST);
};

test.describe("Panels the address carries", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test("the shortcuts sheet reloads with the address", async ({ page }) => {
		await openInbox(page);

		await page.keyboard.press("?");
		await expect(shortcutsSheet(page)).toBeVisible({ timeout: 15_000 });
		await expect(page).toHaveURL(/#shortcuts$/);

		await page.reload();
		await expect(shortcutsSheet(page)).toBeVisible({ timeout: 30_000 });

		await page.keyboard.press("Escape");
		await expect(shortcutsSheet(page)).toHaveCount(0);
		await expect(page).not.toHaveURL(/#shortcuts/);
	});

	test("the rail is in the address once the reader puts it there", async ({
		page,
		run,
	}) => {
		await openInbox(page);

		const first = run.seededSubjects[0];
		const other = run.seededSubjects.find((subject) => subject !== first);
		if (!other) throw new Error("expected a second seeded inbox subject");
		await openMessage(page, first);

		// The rail opens with the thread on this tier and the address stays out of
		// it: a preference is this device's, not something to hand a reader who is
		// sent the link.
		await expect(intelligenceRail(page)).toBeVisible({ timeout: 15_000 });
		await expect(page).not.toHaveURL(/#/);

		await page.getByRole("button", { name: HIDE_RAIL }).click();
		await expect(intelligenceRail(page)).toHaveCount(0);

		await page.getByRole("button", { name: SHOW_RAIL }).click();
		await expect(intelligenceRail(page)).toBeVisible();
		await expect(page).toHaveURL(/#intelligence$/);

		// A second message is a navigation, and the router drops the fragment on
		// one unless the destination carries it. The rail is a pane a reader keeps
		// up while they read down a list, so a row carries it.
		await page.locator(MAILBOX_ROW_LINK).filter({ hasText: other }).click();
		await expect(intelligenceRail(page)).toBeVisible();
		await expect(page).toHaveURL(/#intelligence$/);

		await page.reload();
		await expect(intelligenceRail(page)).toBeVisible({ timeout: 30_000 });
	});

	// The sheet is modal over the rail, not an alternative to it. Modelled as one
	// exclusive slot, `?` unmounted the rail and Esc never brought it back: gone
	// for the session, with the stored preference still saying open.
	test("a sheet opens over the rail and leaves it standing", async ({
		page,
		run,
	}) => {
		await openInbox(page);
		await openMessage(page, run.seededSubjects[0]);
		await expect(intelligenceRail(page)).toBeVisible({ timeout: 15_000 });

		await page.keyboard.press("?");
		await expect(shortcutsSheet(page)).toBeVisible({ timeout: 15_000 });
		await expect(intelligenceRail(page)).toBeVisible();
		await expect(page).toHaveURL(/#intelligence,shortcuts$/);

		await page.keyboard.press("Escape");
		await expect(shortcutsSheet(page)).toHaveCount(0);
		await expect(intelligenceRail(page)).toBeVisible();
		await expect(page).toHaveURL(/#intelligence$/);
	});

	// The address is the only owner of what is open whenever it names anything.
	// Seeding the rail from the preference without that check overwrote the
	// fragment on arrival, and the link's own panel never showed.
	test("a link's panel is the one that opens, not this device's preference", async ({
		page,
		run,
	}) => {
		await openInbox(page);
		await openMessage(page, run.seededSubjects[0]);
		const conversation = page.url();

		await page.goto(`${conversation}#shortcuts`);

		await expect(shortcutsSheet(page)).toBeVisible({ timeout: 30_000 });
		await expect(page).toHaveURL(/#shortcuts$/);
		await expect(intelligenceRail(page)).toHaveCount(0);
	});
});

test.describe("The nav slide-over on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("it is in the address, and going somewhere closes it", async ({
		page,
		run,
	}) => {
		await page.goto(`/mail/${run.inboxId}`);

		await page
			.getByRole("button", { name: "Menu", exact: true })
			.first()
			.click({ timeout: 30_000 });
		await expect(navSlideOver(page)).toBeVisible({ timeout: 15_000 });
		await expect(page).toHaveURL(/#nav$/);

		await page.reload();
		await expect(navSlideOver(page)).toBeVisible({ timeout: 30_000 });

		// Going somewhere is what closes it: the slide-over is not a panel a
		// reader takes with them.
		await navSlideOver(page)
			.getByRole("link", { name: /daily brief/i })
			.click();
		await page.waitForURL(BRIEF_URL);
		await expect(navSlideOver(page)).toHaveCount(0);
		await expect(page).not.toHaveURL(/#nav/);
	});
});
