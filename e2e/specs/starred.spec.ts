/**
 * Regression cover for issue #44 — starred mail did not reach the Starred
 * mailbox.
 *
 * The bug had three independent causes, and each assertion here is aimed at one
 * of them rather than at the symptom they shared:
 *
 *  1. The star never reached the server. A cache patch alone satisfies any
 *     assertion made in the same page session, so the star is re-read after a
 *     RELOAD — the only check an optimistic-only implementation fails.
 *  2. `hasStars` was hardcoded false when a message was first created, so mail
 *     already flagged in another client synced in unstarred and never appeared.
 *     That path exists once per message, at first sync, which is why the
 *     pre-flagged message is seeded in global setup and not here.
 *  3. The list was the newest INBOX page filtered client-side, so a starred
 *     thread outside that window — or outside INBOX at all — structurally could
 *     not appear no matter how many stars were set correctly.
 *
 * The last case also covers issue #70: listing a row and being able to open it
 * are separate wirings, and the pane resolved its selection from the INBOX
 * listing rather than the starred one that produced the row.
 *
 * Locator note: the inbox renders rows as anchors carrying `selectedMessageId`,
 * which is what the other specs match. The Starred pane renders rows as
 * `<button>` (`ComfortableRow`). Reusing the anchor locator here matches zero
 * rows and passes every absence assertion, so rows are addressed by button role
 * throughout.
 */
import type { Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

/** A row in the Starred pane. Button role, never the inbox's anchors. */
const starredRow = (page: Page, subject: string) =>
	page.getByRole("button").filter({ hasText: subject });

/**
 * The pre-flagged seed is starred for the whole run, so its row is proof the
 * list finished loading. Without it, an assertion that some subject is ABSENT
 * would pass against a list that had not rendered yet.
 */
const expectStarredListLoaded = (
	page: Page,
	run: { preFlaggedSubject: string },
) =>
	expect(starredRow(page, run.preFlaggedSubject)).toHaveCount(1, {
		timeout: 30_000,
	});

/**
 * Client-side navigation to Starred, staying in the page session that is
 * already open. The query cache survives this, so an optimistically patched
 * star is still enough to satisfy what renders here.
 */
const navigateToStarred = async (
	page: Page,
	run: { preFlaggedSubject: string },
) => {
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: "Starred", exact: true }).click();
	await page.waitForURL(/\/mail\/flagged/);
	await expectStarredListLoaded(page, run);
};

/**
 * Starred from a cold document load: a new JS context, so a new query client
 * with nothing in it. Everything that renders came back from the server.
 */
const openStarred = async (page: Page, run: { preFlaggedSubject: string }) => {
	await page.goto("/mail");
	await navigateToStarred(page, run);
};

const openInboxMessage = async (page: Page, subject: string) => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	await expect(
		page.locator("a[href*='selectedMessageId']").first(),
	).toBeVisible({ timeout: 30_000 });

	await page.getByText(subject, { exact: true }).first().click();
	await page.waitForURL(/selectedMessageId=/);
	const article = page.getByRole("article");
	await expect(article).toBeVisible({ timeout: 15_000 });
	return article;
};

test.describe("Starred mail", () => {
	test("a message starred from the inbox is in Starred after a reload", async ({
		page,
		run,
	}) => {
		// Not the pre-flagged seed: this one has to make the whole round trip,
		// starting from unstarred.
		const subject = run.seededSubjects.find(
			(candidate) => candidate !== run.preFlaggedSubject,
		);
		if (!subject) throw new Error("no unflagged seeded subject to star");

		const article = await openInboxMessage(page, subject);
		await article
			.getByRole("button", { name: "Add star", exact: true })
			.first()
			.click();
		await expect(
			article.getByRole("button", { name: "Remove star", exact: true }).first(),
		).toBeVisible({ timeout: 15_000 });

		// Still the same page session, so this much an optimistic cache patch also
		// satisfies. It checks the client wiring, not that anything was persisted.
		await navigateToStarred(page, run);
		await expect(starredRow(page, subject)).toHaveCount(1, { timeout: 30_000 });

		// The load-bearing step. A reload drops the query cache — the client keeps
		// no persister — so what renders now came back from the server. A star
		// that only ever patched the cache disappears exactly here.
		await page.reload();
		await expectStarredListLoaded(page, run);
		await expect(starredRow(page, subject)).toHaveCount(1, { timeout: 30_000 });

		// Leave the shared stack as it was found: the specs share one mailbox and
		// one account, so a star left behind is state the next run inherits.
		const reopened = await openInboxMessage(page, subject);
		await reopened
			.getByRole("button", { name: "Remove star", exact: true })
			.first()
			.click();
		await expect(
			reopened.getByRole("button", { name: "Add star", exact: true }).first(),
		).toBeVisible({ timeout: 15_000 });

		await openStarred(page, run);
		await expect(starredRow(page, subject)).toHaveCount(0, { timeout: 30_000 });
	});

	test("mail flagged on the server before it synced arrives starred", async ({
		api,
		page,
		run,
	}) => {
		// `hasStars` was written as a literal false on create, so the server's
		// \Flagged keyword was discarded the one time it mattered. Asserted
		// against the API first: if the flag was lost at sync, no amount of
		// client-side rendering can put it back.
		const starred = await api.listAllThreads({ starred: true });
		const preFlagged = starred.find(
			(thread) => thread.subject === run.preFlaggedSubject,
		);
		expect(
			preFlagged,
			"the pre-flagged seed is missing from the starred listing",
		).toBeDefined();
		expect(preFlagged?.hasStars).toBe(true);

		await openStarred(page, run);
		await expect(starredRow(page, run.preFlaggedSubject)).toHaveCount(1, {
			timeout: 30_000,
		});
	});

	test("a starred message outside INBOX is listed and opens", async ({
		api,
		page,
		run,
	}) => {
		// The old list was the newest INBOX page filtered in the browser, so it
		// could not see a starred thread the page did not already contain. Mail in
		// another folder is the same structural case as mail past the window, and
		// costs one APPEND instead of fifty. Seeded pre-onboarding, like every
		// other fixture, so this asserts the starred scope rather than whether a
		// mid-run append reaches the API.
		const subject = run.starredElsewhereSubject;

		const starred = await waitFor(
			() => api.listAllThreads({ starred: true }),
			(threads) => threads.some((thread) => thread.subject === subject),
			{
				timeoutMs: 40_000,
				what: `the starred message "${subject}" filed in Sent`,
			},
		);
		expect(starred.map((thread) => thread.subject)).toContain(subject);

		// The scopes are genuinely different, not one listing serving both: the
		// unified inbox is INBOX-only, so this message must NOT be there.
		const unified = await api.listAllThreads();
		expect(unified.map((thread) => thread.subject)).not.toContain(subject);

		await openStarred(page, run);
		await expect(starredRow(page, subject)).toHaveCount(1, { timeout: 30_000 });

		// Issue #70: the row listed, but the pane resolved the selection from the
		// unified INBOX listing, which by the assertion above cannot contain this
		// message. Selecting it changed the URL and opened nothing.
		await starredRow(page, subject).click();
		await page.waitForURL(/selectedMessageId=/);
		const article = page.getByRole("article").first();
		await expect(article).toBeVisible({ timeout: 15_000 });
		await expect(
			article.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible({ timeout: 15_000 });
	});
});
