/**
 * Between 1024 and 1280px the shell mounts the reading pane but has no room for
 * the intelligence rail. The authenticity banner's "Why?" link pointed at that
 * rail anyway, so pressing it flipped a flag and nothing appeared — a dead
 * control on the one message a reader has most reason to ask about.
 *
 * The drawer is the surface at this width. It is modal, so the assertions below
 * are as much about when it stays shut: `intelligenceOpen` is the rail's
 * persisted preference and the DKIM auto-open sets it on every tier, so a drawer
 * driven from that flag would throw a scrim over a message the moment one was
 * selected.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { INBOX_LIST, listOnScreen } from "../src/lists.js";
import {
	MAILBOX_ROW_LINK,
	MAILBOX_THREAD_URL,
	MAILBOX_URL,
} from "../src/urls.js";

const SHOW_INFO = "Show intelligence sidebar";
const HIDE_INFO = "Hide intelligence sidebar";

const intelligenceDrawer = (page: Page): Locator =>
	page.getByRole("dialog", { name: "Message details" });

/**
 * The scrim carries the same accessible name as the header's close button and
 * comes first in the drawer, so the visible control is the second of the two.
 */
const closeControl = (page: Page): Locator =>
	intelligenceDrawer(page).getByRole("button", { name: "Close menu" }).last();

const openMessage = async (page: Page, subject: string): Promise<void> => {
	const row = page.locator(MAILBOX_ROW_LINK).filter({ hasText: subject });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	await page.waitForURL(MAILBOX_THREAD_URL);
	// Named, not just "an article is up": this helper also switches from one open
	// thread to another, where a bare presence check passes on the thread being
	// navigated away from.
	await expect(
		page
			.getByRole("article")
			.getByRole("heading", { name: subject, exact: true }),
	).toBeVisible({ timeout: 15_000 });
};

test.describe("Intelligence where the rail does not fit", () => {
	test.use({ viewport: { width: 1100, height: 900 } });

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
	});

	test("opening the warned message shows the banner and no scrim", async ({
		page,
		run,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);

		await expect(
			page.getByText(run.dkimMismatchFromDomain, { exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(intelligenceDrawer(page)).toHaveCount(0);
		await expect(page.getByRole("button", { name: SHOW_INFO })).toBeEnabled();
	});

	test("the banner's Why? opens the intelligence surface", async ({
		page,
		run,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);

		await page.getByRole("button", { name: "Why?", exact: true }).click();

		const drawer = intelligenceDrawer(page);
		await expect(drawer).toBeVisible({ timeout: 15_000 });
		await expect(
			drawer.getByText("Intelligence", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: HIDE_INFO })).toBeVisible();
	});

	test("dismissing it closes it, and it stays shut on the way back", async ({
		page,
		run,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);
		await page.getByRole("button", { name: "Why?", exact: true }).click();
		await expect(intelligenceDrawer(page)).toBeVisible({ timeout: 15_000 });

		await closeControl(page).click();
		await expect(intelligenceDrawer(page)).toHaveCount(0);

		// Away to another thread and back. A drawer driven by a bare flag would
		// still be set here, and the reader would meet a scrim they never asked
		// for a second time.
		const other = run.seededSubjects.find(
			(subject) => subject !== run.dkimMismatchSubject,
		);
		if (!other) throw new Error("expected a second seeded inbox subject");
		await openMessage(page, other);
		await expect(intelligenceDrawer(page)).toHaveCount(0);

		await openMessage(page, run.dkimMismatchSubject);
		await expect(intelligenceDrawer(page)).toHaveCount(0);
	});

	// The toolbar's control reaches the same surface the banner does. It is the
	// only way in for a message with no warning on it, and the scrim covers the
	// toolbar once the drawer is up, so the drawer's own control is what closes
	// it again — what the toolbar has to get right is the state it reports on
	// either side of that.
	test("the toolbar's intelligence control opens the same surface", async ({
		page,
		run,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);

		await page.getByRole("button", { name: SHOW_INFO }).click();
		const drawer = intelligenceDrawer(page);
		await expect(drawer).toBeVisible({ timeout: 15_000 });
		await expect(
			drawer.getByText("Intelligence", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: HIDE_INFO })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await closeControl(page).click();
		await expect(intelligenceDrawer(page)).toHaveCount(0);
		await expect(page.getByRole("button", { name: SHOW_INFO })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});
});
