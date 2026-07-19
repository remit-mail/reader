/**
 * Regression cover for #44: starring a message from an inbox did not put it in
 * the Starred mailbox.
 *
 * The break was invisible to unit tests on either side of the seam. The server
 * recorded the star correctly and the view queried correctly; the client just
 * derived "is this starred" from the star *colour*, which stays at its `none`
 * default forever because nothing in the UI sets a colour. So this drives the
 * whole path from a click in the inbox to a row in the Starred mailbox, and it
 * re-reads after a reload — an optimistic cache patch alone would satisfy the
 * first assertion while the server-side truth stayed empty.
 *
 * One test rather than a star spec and an unstar spec: the round trip leaves
 * the shared deployment exactly as it found it, and the unstar half cannot be
 * stranded by a failure in the star half.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";

const sidebarOf = (page: Page) =>
	page.getByRole("navigation", { name: "Mailboxes", exact: true });

const openInbox = async (page: Page) => {
	await page.goto("/mail");
	const sidebar = sidebarOf(page);
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	// Inbox rows are anchors carrying the selection in their href; the Starred
	// pane renders buttons instead, so this locator is inbox-only on purpose.
	await expect(
		page.locator("a[href*='selectedMessageId']").first(),
	).toBeVisible({ timeout: 30_000 });
};

/**
 * The Starred nav link drops any open message from the search params, so the
 * pane that loads has no reading pane to echo a subject into the list's text.
 */
const openStarred = async (page: Page) => {
	const sidebar = sidebarOf(page);
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: "Starred", exact: true }).click();
	await page.waitForURL(/\/mail\/flagged/);
};

/** Open a message in the reading pane and wait for its body to settle. */
const openMessage = async (page: Page, subject: string) => {
	await page.getByText(subject, { exact: true }).first().click();
	await page.waitForURL(/selectedMessageId=/);
	const article = page.getByRole("article");
	await expect(article).toBeVisible({ timeout: 15_000 });
	await expect(article.locator(".animate-pulse")).toBeHidden({
		timeout: 20_000,
	});
	await expect(article.getByRole("heading", { level: 1 })).toHaveText(subject);
};

/**
 * The desktop toolbar's star control. Its label does not change with state —
 * the same button stars and unstars — so the assertions below read the list,
 * never the button.
 */
const toggleStar = async (page: Page) => {
	await page.getByRole("button", { name: "Star", exact: true }).click();
};

test.describe("Starred mailbox", () => {
	test("a message starred in the inbox appears in Starred, persists, and can be unstarred", async ({
		page,
		run,
	}) => {
		const [starred, ...untouched] = run.seededSubjects;

		await openInbox(page);
		await openMessage(page, starred);
		await toggleStar(page);

		await openStarred(page);
		await expect(page.getByText(starred, { exact: true }).first()).toBeVisible({
			timeout: 20_000,
		});

		// The star reached the server rather than only the query cache: a reload
		// throws the cache away and re-reads the deployment.
		await page.reload();
		await expect(page.getByText(starred, { exact: true }).first()).toBeVisible({
			timeout: 30_000,
		});

		// Starred is the starred message and nothing else. The run owns its
		// mailbox, so the other seeded subjects are knowably absent rather than
		// merely unasserted.
		for (const subject of untouched) {
			await expect(page.getByText(subject, { exact: true })).toHaveCount(0);
		}

		// Unstar from the inbox, the same path that set it, and leave the shared
		// deployment as this test found it.
		await openInbox(page);
		await openMessage(page, starred);
		await toggleStar(page);

		await openStarred(page);
		await expect(page.getByText(starred, { exact: true })).toHaveCount(0, {
			timeout: 20_000,
		});

		await page.reload();
		await expect(page.getByText(starred, { exact: true })).toHaveCount(0, {
			timeout: 30_000,
		});
	});
});
