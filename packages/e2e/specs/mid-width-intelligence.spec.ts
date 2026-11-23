/**
 * The intelligence drawer is the surface below the rail's width, including
 * phones. A header-derived DKIM mismatch alone no longer raises a banner: the
 * spam verdict owns warnings, and this stack has no calibrated spam thresholds.
 * Opening that message must leave reading and Back unobstructed; the toolbar
 * must still reach the drawer, and dismissal must survive navigation.
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

const intelligenceDrawer = (page: Page): Locator =>
	page.getByRole("dialog", { name: "Message details" });

/**
 * The scrim carries the same accessible name as the header's close button and
 * comes first in the drawer, so the visible control is the second of the two.
 */
const closeControl = (page: Page): Locator =>
	intelligenceDrawer(page).getByRole("button", { name: "Close menu" }).last();

/** The phone list renders rows rather than the desktop anchors. */
const phoneRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject }).first();

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

	test("a DKIM mismatch without a spam action leaves reading clear", async ({
		page,
		run,
		api,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);

		const thread = (await api.listThreads(run.inboxId)).find(
			(row) => row.subject === run.dkimMismatchSubject,
		);
		if (!thread) throw new Error("expected the mismatch fixture in the inbox");
		const message = (await api.listThreadMessages(thread.threadId)).find(
			(row) => row.subject === run.dkimMismatchSubject,
		);
		expect(message?.authenticity).toMatchObject({
			fromDomain: run.dkimMismatchFromDomain,
			dkimMismatch: true,
		});
		expect(message?.spamVerdict).toMatchObject({
			state: "Checked",
			action: "None",
		});
		await expect(
			page.getByRole("button", { name: "Why", exact: true }),
		).toHaveCount(0);
		await expect(intelligenceDrawer(page)).toHaveCount(0);
		await expect(page.getByRole("button", { name: SHOW_INFO })).toBeEnabled();
	});

	test("the intelligence control opens the message details", async ({
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
		await expect(page.getByRole("button", { name: HIDE_INFO })).toBeVisible();
	});

	test("dismissing it closes it, and it stays shut on the way back", async ({
		page,
		run,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);
		await page.getByRole("button", { name: SHOW_INFO }).click();
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
	// only way in for a message with no warning on it, and the drawer is modal:
	// the pane runs to the screen's right edge and the toggle sits at that end of
	// the toolbar, so the panel itself is what a press aimed at the toggle
	// reaches. The toggle is the way in and nothing else; getting back out is the
	// drawer's own job, and the toggle is live again behind it (#747).
	test("the toolbar's intelligence control opens the same surface", async ({
		page,
		run,
	}) => {
		await openMessage(page, run.dkimMismatchSubject);

		const toggle = page.getByRole("button", { name: SHOW_INFO });
		const box = await toggle.boundingBox();
		if (!box) throw new Error("expected the intelligence toggle on screen");

		await toggle.click();
		const drawer = intelligenceDrawer(page);
		await expect(drawer).toBeVisible({ timeout: 15_000 });
		await expect(
			drawer.getByText("Intelligence", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: HIDE_INFO })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// Named, not just "something of the drawer's": the dialog root is
		// `fixed inset-0`, so every point on screen answers to it. A panel that
		// shrank or moved to the other edge has to fail here.
		const covering = await page.evaluate(
			({ x, y }) => {
				const hit = document.elementFromPoint(x, y);
				if (!hit) return "nothing";
				const dialog = hit.closest('[role="dialog"]');
				if (!dialog) return "toolbar";
				const panel = dialog.querySelector(".safe-area-frame");
				return panel?.contains(hit) ? "panel" : "scrim";
			},
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 },
		);
		expect(covering).toBe("panel");

		await closeControl(page).click();
		await expect(intelligenceDrawer(page)).toHaveCount(0);
		await expect(toggle).toHaveAttribute("aria-pressed", "false");

		await toggle.click();
		await expect(intelligenceDrawer(page)).toBeVisible({ timeout: 15_000 });
	});
});

/**
 * The phone has no rail at any width, so the drawer is its only intelligence
 * surface and the same rules bind. This is where the scrim was reachable: the
 * DKIM auto-open put the drawer up on arrival, and "Back to messages" — the
 * only way out of a thread on a phone — was pressed into it.
 */
test.describe("Intelligence on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("a message without a spam action opens clear, and Back still leaves it", async ({
		page,
		run,
	}) => {
		await page.goto(`/mail/${run.inboxId}`);
		const row = phoneRow(page, run.dkimMismatchSubject);
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);

		await expect(
			page
				.getByRole("article")
				.getByRole("heading", { name: run.dkimMismatchSubject, exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(intelligenceDrawer(page)).toHaveCount(0);

		const back = page.getByRole("button", { name: "Back to messages" });
		await expect(back).toBeVisible();
		await back.click();
		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
	});

	test("opening and dismissing intelligence gives the message back", async ({
		page,
		run,
	}) => {
		await page.goto(`/mail/${run.inboxId}`);
		const row = phoneRow(page, run.dkimMismatchSubject);
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);

		await page.getByRole("button", { name: "Show intelligence panel" }).click();
		await expect(intelligenceDrawer(page)).toBeVisible({ timeout: 15_000 });

		await closeControl(page).click();
		await expect(intelligenceDrawer(page)).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Back to messages" }),
		).toBeVisible();
	});
});

/**
 * The same width on the daily brief, which is where `/mail` lands — so this is
 * the default view, not a corner of the app. The brief read the rail's own
 * width gate as its answer for both tiers and wired no drawer at all, so the
 * toolbar's control was greyed out here and the banner's "Why?" was absent at
 * every desktop width (#817).
 */
test.describe("Intelligence on the brief where the rail does not fit", () => {
	test.use({ viewport: { width: 1100, height: 900 } });

	test.beforeEach(async ({ page, run }) => {
		await page.goto("/mail");
		const row = page
			.locator("[data-message-row]")
			.filter({ hasText: run.dkimMismatchSubject });
		await expect(async () => {
			await page.reload();
			await expect(row).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 60_000 });
		await row.click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await expect(
			page.getByRole("article").getByRole("heading", {
				name: run.dkimMismatchSubject,
				exact: true,
			}),
		).toBeVisible({ timeout: 15_000 });
	});

	test("the toolbar's intelligence control opens the drawer", async ({
		page,
	}) => {
		await expect(page.getByRole("button", { name: SHOW_INFO })).toBeEnabled();

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
	});

	test("closing intelligence gives the brief message back", async ({
		page,
	}) => {
		await page.getByRole("button", { name: SHOW_INFO }).click();

		const drawer = intelligenceDrawer(page);
		await expect(drawer).toBeVisible({ timeout: 15_000 });
		await expect(
			drawer.getByText("Intelligence", { exact: true }),
		).toBeVisible();

		await closeControl(page).click();
		await expect(intelligenceDrawer(page)).toHaveCount(0);
	});
});
