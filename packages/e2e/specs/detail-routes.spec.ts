/**
 * The brief's reading pane is a route (#718).
 *
 * `/mail/brief/<thread>/<message>` is the whole address. What used to make a
 * brief conversation openable was three query params, one of them a mailbox,
 * because the brief spans folders and the pane fetches by thread. A folder is
 * the thread's own data, so those params were standing in for a missing segment
 * — which is what the cold load below proves: the message it opens is in no
 * listing the brief holds, so nothing but the address can resolve it.
 *
 * Two failure shapes escaped every earlier test: a surface opened with nothing
 * rendering it, and an action queued that fired later. So the pattern here is
 * assert, do something unrelated, assert again — a single assertion straight
 * after the navigation passes on the broken code.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { BRIEF_THREAD_URL, BRIEF_URL } from "../src/urls.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP });

const briefRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

const conversation = (page: Page): Locator => page.getByRole("article").first();

const searchField = (page: Page): Locator =>
	page.getByRole("textbox", { name: "Search mail" });

/** The reading-pane toolbar's hint when a verb has no thread to act on. */
const NO_THREAD_HINT = "Open a message first";

/** The brief with its rows on screen, which is what a click needs. */
const openBrief = async (page: Page, subject: string): Promise<void> => {
	await page.goto("/mail");
	await expect(async () => {
		await page.reload();
		await expect(briefRow(page, subject)).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 60_000 });
};

const settledConversation = async (
	page: Page,
	subject: string,
): Promise<Locator> => {
	const article = conversation(page);
	await expect(article).toBeVisible({ timeout: 30_000 });
	await expect(article.locator(".animate-pulse")).toBeHidden({
		timeout: 30_000,
	});
	await expect(
		article.getByRole("heading", { name: subject, exact: true }),
	).toBeVisible({ timeout: 30_000 });
	return article;
};

test.describe("A brief conversation deep-links from cold (#718)", () => {
	test.setTimeout(120_000);

	test("a pasted address opens a message the brief never listed", async ({
		api,
		page,
		run,
	}) => {
		const subject = run.starredElsewhereSubject;

		// The fixture is the starred message filed in Sent. The starred scope spans
		// every folder and finds it; the unified listing the brief renders is the
		// INBOX and does not, so the address is all there is to go on — asserted
		// rather than assumed, because it is the whole point of the case.
		const starred = await api.listAllThreads({ starred: true });
		const target = starred.find((thread) => thread.subject === subject);
		expect(
			target,
			`the starred scope lists "${subject}", the fixture this case needs`,
		).toBeDefined();
		if (!target) return;

		const unified = await api.listAllThreads();
		expect(unified.map((thread) => thread.subject)).not.toContain(subject);

		// A fresh context: nothing loaded, no list rendered, and no earlier
		// navigation leaving a cached row to fall back on.
		await page.goto(`/mail/brief/${target.threadId}/${target.messageId}`);

		const article = await settledConversation(page, subject);
		await expect(article).toContainText("Starred, and not in the inbox.");
		await expect(page.getByText("Select a thread to read")).toHaveCount(0);

		// The load did not rewrite the address back to the list, so both segments
		// are still there to share.
		await expect(page).toHaveURL(
			new RegExp(`/mail/brief/${target.threadId}/${target.messageId}`),
		);

		// Assert again after something unrelated: the brief's own list arrives
		// behind the conversation, and must not take the pane back.
		await expect(briefRow(page, run.seededSubjects[0])).toBeVisible({
			timeout: 60_000,
		});
		await expect(
			article.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible();

		// And the verbs act on it. Move needs the account and the folder the thread
		// is filed in, which is exactly what a cold address does not carry: the
		// thread's own rows answer for it, so the button opens a real picker rather
		// than explaining it has nothing to act on. Left open — Escape is the key
		// that closes the conversation, so it is not a way to dismiss a popover.
		await page.getByRole("button", { name: "Move to mailbox" }).click();
		await expect(page.getByText(NO_THREAD_HINT)).toHaveCount(0);
		await expect(
			article.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible();
	});

	test("the thread on its own opens, with no message named", async ({
		api,
		page,
		run,
	}) => {
		const subject = run.starredElsewhereSubject;
		const starred = await api.listAllThreads({ starred: true });
		const target = starred.find((thread) => thread.subject === subject);
		expect(target).toBeDefined();
		if (!target) return;

		// The message segment says which message is expanded; without one the
		// newest answers for the conversation, so the thread is addressable alone.
		await page.goto(`/mail/brief/${target.threadId}`);
		await settledConversation(page, subject);
	});
});

test.describe("Searching around an open brief conversation (#718)", () => {
	test.setTimeout(120_000);

	test("a query typed over an open thread keeps every character", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openBrief(page, subject);

		await briefRow(page, subject).click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await settledConversation(page, subject);

		// The trap: the thread is a route under the list and the search field is
		// state in the shell above it. If opening one read as leaving the view, the
		// field would re-seed from the URL and the query would vanish as it was
		// typed.
		const field = searchField(page);
		await field.click();
		await field.pressSequentially("invoice");
		await expect(field).toHaveValue("invoice");

		// A query going active closes the reading pane — a message from the
		// pre-search list is not a result. It closes by the address walking up to
		// the list, so no thread is left matched behind the result set.
		await page.waitForURL(/[?&]q=invoice/);
		await expect(page).not.toHaveURL(BRIEF_THREAD_URL);
		await expect(page).toHaveURL(BRIEF_URL);

		// Assert again once the search has settled: the field still holds what was
		// typed, and nothing brought the conversation back.
		await expect(field).toHaveValue("invoice");
		await expect(conversation(page)).toHaveCount(0);
	});

	test("clearing the query leaves the conversation open", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openBrief(page, subject);

		const field = searchField(page);
		await field.click();
		await field.pressSequentially("Quarterly");
		await page.waitForURL(/[?&]q=Quarterly/);

		await briefRow(page, subject).click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await settledConversation(page, subject);

		// Mirroring an emptied query writes the query and nothing else: it is the
		// one write that keeps the address it found, because dropping the search is
		// no reason to shut what the reader is reading.
		await field.fill("");
		await page.waitForURL((url) => !url.search.includes("q="));
		await expect(page).toHaveURL(BRIEF_THREAD_URL);
		await expect(conversation(page)).toBeVisible();

		// Assert again with the unnarrowed list back on screen.
		await expect(briefRow(page, run.seededSubjects[1])).toBeVisible({
			timeout: 30_000,
		});
		await expect(conversation(page)).toBeVisible();
	});
});
