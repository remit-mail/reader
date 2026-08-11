/**
 * The reading-pane toolbar's control set is fixed (#52). Buttons do not enter
 * and leave the bar as the view or the selection changes; a button that cannot
 * act right now is disabled and still there.
 *
 * The daily brief is the view that regressed: it never rendered the (i) button
 * at all, so it is asserted here alongside a mailbox to show the two views
 * agree.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { INBOX_LIST, listOnScreen } from "../src/lists.js";
import {
	BRIEF_THREAD_URL,
	MAILBOX_ROW_LINK,
	MAILBOX_THREAD_URL,
	MAILBOX_URL,
} from "../src/urls.js";

const SHOW_INFO = "Show intelligence sidebar";
const HIDE_INFO = "Hide intelligence sidebar";

/**
 * Brief rows are buttons, not links — their accessible name is the sender,
 * subject and snippet the row renders. Addressing them by subject is what makes
 * a failure here mean "the row did not open" rather than "the selector was
 * written against markup that never existed".
 */
/**
 * The page carries two `complementary` landmarks — the mailbox sidebar and this
 * panel — so the role alone is ambiguous. The panel is addressed by the header
 * it renders, which is the only thing distinguishing the two to a reader.
 */
const infoPanel = (page: Page): Locator =>
	page
		.getByRole("complementary")
		.filter({ has: page.getByText("Intelligence", { exact: true }) });

const openBriefMessage = async (page: Page, subject: string): Promise<void> => {
	const row = page.getByRole("button").filter({ hasText: subject }).first();
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	// The brief's open thread is a path segment (#718); the other lists still
	// carry theirs in the query.
	await page.waitForURL(BRIEF_THREAD_URL);
};

const openInboxMessage = async (page: Page): Promise<void> => {
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(MAILBOX_URL);
	await listOnScreen(page, INBOX_LIST);
	const row = page.locator(MAILBOX_ROW_LINK).first();
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	await page.waitForURL(MAILBOX_THREAD_URL);
};

test.describe("Reading-pane toolbar", () => {
	// Wide enough for the intelligence rail (≥1280px), so "disabled" means the
	// selection is missing rather than the window being too narrow.
	test.describe("wide enough for the rail", () => {
		test.use({ viewport: { width: 1440, height: 900 } });

		test("the daily brief offers the info button with nothing selected, disabled", async ({
			page,
		}) => {
			await page.goto("/mail");

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
		});

		test("opening a message from the daily brief enables the info button and its panel", async ({
			page,
			run,
		}) => {
			await page.goto("/mail");

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();

			await openBriefMessage(page, run.seededSubjects[0]);

			await expect(info).toBeEnabled({ timeout: 15_000 });
			await info.click();

			await expect(page.getByRole("button", { name: HIDE_INFO })).toBeVisible();
			await expect(infoPanel(page)).toBeVisible();
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
			await page.waitForURL(MAILBOX_URL);
			await listOnScreen(page, INBOX_LIST);

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
		});
	});

	// 1024–1279: the reading pane is mounted but the rail is not. What the toggle
	// reads as here follows the view. A mailbox has the drawer, so the control
	// acts and says so; the brief has no surface at this width, so it says the
	// opposite. Neither may sit in the pressed "Hide" state before it is used.
	test.describe("too narrow for the rail", () => {
		test.use({ viewport: { width: 1100, height: 900 } });

		test("an open message in the daily brief leaves the info button disabled and unpressed", async ({
			page,
			run,
		}) => {
			await page.goto("/mail");
			await openBriefMessage(page, run.seededSubjects[0]);

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
			await expect(info).toHaveAttribute("aria-pressed", "false");
			await expect(page.getByRole("button", { name: HIDE_INFO })).toHaveCount(
				0,
			);
		});

		// What it opens, and what closes it again, is
		// `mid-width-intelligence.spec.ts`.
		test("an open message in a mailbox leaves the info button enabled and unpressed", async ({
			page,
		}) => {
			await page.goto("/mail");
			await openInboxMessage(page);

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeEnabled();
			await expect(info).toHaveAttribute("aria-pressed", "false");
			await expect(page.getByRole("button", { name: HIDE_INFO })).toHaveCount(
				0,
			);
		});
	});
});
