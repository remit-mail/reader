/**
 * Issue #703: with a message open, Compose did nothing until typing in search
 * made the window appear.
 */
import { expect, test } from "../src/fixtures.js";
import { INBOX_LIST, listOnScreen } from "../src/lists.js";
import {
	BRIEF_URL,
	COMPOSE_URL,
	MAILBOX_ROW_LINK,
	MAILBOX_THREAD_URL,
	MAILBOX_URL,
} from "../src/urls.js";

/** The brief's own compose surface, so a spec can say which list mounted it. */
const BRIEF_COMPOSE_URL = /\/mail\/brief\/compose(\?|$)/;

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
		await page.waitForURL(MAILBOX_URL);
		await listOnScreen(page, INBOX_LIST);

		await page.locator(MAILBOX_ROW_LINK).first().click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 30_000 });
	});

	test("the surface arrives on the click, not on the next keystroke in search", async ({
		page,
	}) => {
		const search = page.getByRole("textbox", { name: "Search mail" });
		await search.click();
		await expect(search).toBeFocused();

		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const recipients = page.getByPlaceholder("Recipients");
		await expect(recipients).toBeVisible({ timeout: 30_000 });

		// The pane shows one thing, and the URL says the same: the thread is closed
		// rather than sitting behind the surface waiting to reappear.
		await expect(page.getByRole("article")).toBeHidden();
		await page.waitForURL(COMPOSE_URL);

		// Whole and settled, writing surface included, before anything else is
		// typed. Where the caret sits inside it is the composer's own business.
		await expect(page.getByTestId("compose-body")).toBeVisible({
			timeout: 30_000,
		});

		// Searching is what used to summon the queued surface. Nothing arrives on
		// it now: the query lands in the field it was typed into, one composer is on
		// screen, and the conversation does not come back.
		await search.click();
		await search.pressSequentially("invoice");
		await expect(search).toBeFocused();
		await expect(search).toHaveValue("invoice");
		await expect(recipients).toHaveCount(1);
		await expect(recipients).toBeVisible();
		await expect(page.getByRole("article")).toBeHidden();
	});

	test("the c shortcut opens it from the open message too", async ({
		page,
	}) => {
		await page.getByRole("article").click({ position: { x: 4, y: 4 } });
		await page.keyboard.press("c");

		await expect(page.getByPlaceholder("Recipients")).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole("article")).toBeHidden();
	});
});

/**
 * Every list mounts the surface now, so a compose started on the brief stays on
 * the brief. What is left to pin is what the old carry-to-a-mailbox workaround
 * was hiding: nothing survives the navigation away from it.
 */
test.describe("Compose off the daily brief", () => {
	test.setTimeout(120_000);

	const brief = async (page: import("@playwright/test").Page) => {
		await page.goto("/mail");
		const sidebar = page.getByRole("navigation", {
			name: "Mailboxes",
			exact: true,
		});
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await expect(sidebar.getByRole("link", { name: /inbox/i })).toBeVisible({
			timeout: 30_000,
		});
		return sidebar;
	};

	test("c opens the surface where it was pressed", async ({ page }) => {
		await brief(page);

		await page.keyboard.press("c");

		await page.waitForURL(BRIEF_COMPOSE_URL);
		await expect(page.getByPlaceholder("Recipients")).toBeVisible({
			timeout: 30_000,
		});
	});

	// Walking off the surface used to leave compose open behind a view that
	// cannot show it, and it then appeared unannounced on the next mailbox the
	// user opened. Leaving the route is now the whole of closing it.
	test("walking off it leaves nothing queued", async ({ page }) => {
		const sidebar = await brief(page);
		const recipients = page.getByPlaceholder("Recipients");

		await page.keyboard.press("c");
		await expect(recipients).toBeVisible({ timeout: 30_000 });

		await page.goBack();
		await page.waitForURL(BRIEF_URL);
		await expect(recipients).toHaveCount(0);

		await sidebar.getByRole("link", { name: /inbox/i }).click();
		await page.waitForURL(MAILBOX_URL);
		await listOnScreen(page, INBOX_LIST);
		await expect(page.locator(MAILBOX_ROW_LINK).first()).toBeVisible({
			timeout: 30_000,
		});
		await expect(recipients).toHaveCount(0);
	});
});
