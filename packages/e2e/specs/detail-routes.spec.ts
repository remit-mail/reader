/**
 * A list's reading pane is a route (#718, #713).
 *
 * `/mail/<list>/<thread>/<message>` is the whole address. What used to make a
 * conversation openable was query params — a message, a thread, and for the
 * brief a mailbox too — resolved against whatever rows the list had loaded. The
 * thread is the address, so those params were standing in for a missing segment,
 * which is what the cold loads below prove: each opens a message no listing on
 * the page holds, so nothing but the address can resolve it.
 *
 * The outbox is the same move one list over: `/mail/outbox/draft/<message>`
 * replaces a `selectedOutboxMessageId` param that only that list read.
 *
 * Two failure shapes escaped every earlier test: a surface opened with nothing
 * rendering it, and an action queued that fired later. So the pattern here is
 * assert, do something unrelated, assert again — a single assertion straight
 * after the navigation passes on the broken code.
 */
import type { Locator, Page } from "@playwright/test";
import type { ApiClient } from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	BRIEF_THREAD_URL,
	BRIEF_URL,
	FLAGGED_THREAD_URL,
	MAILBOX_ROW_LINK,
	MAILBOX_THREAD_URL,
	OUTBOX_MESSAGE_URL,
	OUTBOX_URL,
} from "../src/urls.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP });

const briefRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

const conversation = (page: Page): Locator => page.getByRole("article").first();

const outboxRow = (page: Page, subject: string): Locator =>
	page.locator("[data-list-row]").filter({ hasText: subject });

/** A row in the Starred pane, which renders buttons rather than the anchors. */
const starredRow = (page: Page, subject: string): Locator =>
	page.getByRole("button").filter({ hasText: subject });

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

/**
 * The outbox is one shared list of messages on their way out, so a message it
 * holds is addressed by its own id — there is no thread and no folder above it.
 */
test.describe("An outbox message lives in the address (#713)", () => {
	test.setTimeout(120_000);

	const tag = `outbox-detail-${Date.now()}`;
	const subject = `Outbox detail ${tag}`;
	const body = "Queued against an account that cannot send.";

	/**
	 * A message the outbox list will hold. The shared account has no SMTP, so
	 * the worker settles the row at `blocked` rather than sending it — which is
	 * both what keeps it listed and what makes it removable again.
	 */
	const seedOutboxMessage = async (
		api: ApiClient,
		accountId: string,
	): Promise<string> => {
		const created = await api.sendMessage({
			accountId,
			toAddresses: ["ada@remit.test"],
			subject,
			textBody: body,
		});
		await waitFor(
			() => api.getOutboxMessage(created.outboxMessageId),
			(message) => message.status === "blocked" || message.status === "failed",
			{ what: `the outbox row for "${subject}" to settle unsent` },
		);
		return created.outboxMessageId;
	};

	test.afterEach(async ({ api }) => {
		for (const entry of await api.listRemovableOutboxMessages()) {
			if (entry.subject.includes(tag)) {
				await api.deleteOutboxMessage(entry.outboxMessageId);
			}
		}
	});

	test("a pasted address opens the message, with no list behind it", async ({
		api,
		page,
		run,
	}) => {
		const outboxMessageId = await seedOutboxMessage(api, run.accountId);

		// A fresh context: no list rendered, no row clicked, nothing but the
		// address to say which message the pane is for.
		await page.goto(`/mail/outbox/draft/${outboxMessageId}`);

		await expect(
			page.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(body)).toBeVisible();
		await expect(page.getByText("Select a message to read")).toHaveCount(0);

		// The load did not rewrite the address back to the list, so it is still
		// there to share.
		await expect(page).toHaveURL(OUTBOX_MESSAGE_URL);

		// Assert again after something unrelated: the outbox list arrives behind
		// the message and must not take the pane back.
		await expect(
			outboxRow(page, subject).or(page.getByText("No outbox messages")),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible();
	});

	test("opening a message from the list is a navigation, and back undoes it", async ({
		api,
		page,
		run,
	}) => {
		await seedOutboxMessage(api, run.accountId);

		await page.goto("/mail/outbox");
		await outboxRow(page, subject).click({ timeout: 30_000 });

		await expect(page).toHaveURL(OUTBOX_MESSAGE_URL);
		await expect(
			page.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible({ timeout: 30_000 });

		// Walk off the outbox entirely and come back the way a reader does. The
		// message is a route, so returning to the address returns the pane.
		await page
			.getByRole("navigation", { name: "Mailboxes", exact: true })
			.getByRole("link", { name: /daily brief/i })
			.click();
		await page.waitForURL(BRIEF_URL);
		await expect(
			page.getByRole("heading", { name: subject, exact: true }),
		).toHaveCount(0);

		await page.goBack();
		await expect(page).toHaveURL(OUTBOX_MESSAGE_URL);
		await expect(
			page.getByRole("heading", { name: subject, exact: true }),
		).toBeVisible({ timeout: 30_000 });

		// One press, one surface: back again leaves the message on the list rather
		// than skipping the outbox altogether.
		await page.goBack();
		await expect(page).toHaveURL(OUTBOX_URL);
		await expect(page.getByText("Select a message to read")).toBeVisible({
			timeout: 30_000,
		});
	});
});

test.describe("A folder's conversation deep-links from cold (#713)", () => {
	test.setTimeout(120_000);

	test("a pasted address opens a message the folder never listed", async ({
		api,
		page,
		run,
	}) => {
		const subject = run.starredElsewhereSubject;

		// The fixture is the starred message filed in Sent. The address below
		// browses INBOX, so the list this page renders cannot hold it — asserted
		// rather than assumed, because it is the whole point of the case. The
		// folder in the address says which list is being browsed; the thread says
		// what to read, and its own rows say where that mail is filed.
		const starred = await api.listAllThreads({ starred: true });
		const target = starred.find((thread) => thread.subject === subject);
		expect(
			target,
			`the starred scope lists "${subject}", the fixture this case needs`,
		).toBeDefined();
		if (!target) return;

		const inbox = await api.listThreads(run.inboxId);
		expect(inbox.map((thread) => thread.subject)).not.toContain(subject);

		// A fresh context: nothing loaded, no list rendered, and no earlier
		// navigation leaving a cached row to fall back on.
		await page.goto(
			`/mail/${run.inboxId}/${target.threadId}/${target.messageId}`,
		);

		const article = await settledConversation(page, subject);
		await expect(article).toContainText("Starred, and not in the inbox.");
		await expect(page.getByText("Select a thread to read")).toHaveCount(0);

		// The load did not rewrite the address back to the list, so both segments
		// are still there to share.
		await expect(page).toHaveURL(
			new RegExp(`/mail/${run.inboxId}/${target.threadId}/${target.messageId}`),
		);

		// Assert again after something unrelated: the folder's own rows arrive
		// behind the conversation, and must not take the pane back.
		await expect(page.locator(MAILBOX_ROW_LINK).first()).toBeVisible({
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
		await page.goto(`/mail/${run.inboxId}/${target.threadId}`);
		await settledConversation(page, subject);
	});

	test("a row opened from the folder survives the list settling under it", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await page.goto(`/mail/${run.inboxId}`);
		const row = page
			.locator(MAILBOX_ROW_LINK)
			.filter({ hasText: subject })
			.first();
		await expect(row).toBeVisible({ timeout: 60_000 });

		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await settledConversation(page, subject);

		// Assert again after something unrelated: paging and refetching go on
		// behind the conversation, and none of it may close what is being read.
		await expect(page.locator(MAILBOX_ROW_LINK)).toHaveCount(
			run.seededSubjects.length,
			{ timeout: 60_000 },
		);
		await expect(page).toHaveURL(MAILBOX_THREAD_URL);
		await expect(conversation(page)).toBeVisible();
	});
});


test.describe("A flagged conversation deep-links from cold (#713)", () => {
	test.setTimeout(120_000);

	test("a pasted address opens a message the starred list never held", async ({
		api,
		page,
		run,
	}) => {
		// An unstarred INBOX message. The starred scope is the only listing the
		// flagged view loads, so this thread is in no list it holds — which makes
		// the address the only thing that can resolve it. Picked from the listings
		// rather than named, because the specs share one mailbox and a star set by
		// another of them would take a fixed subject out of this case.
		const starred = await api.listAllThreads({ starred: true });
		const starredSubjects = new Set(starred.map((thread) => thread.subject));
		const unified = await api.listAllThreads();
		const target = unified.find(
			(thread) => thread.subject && !starredSubjects.has(thread.subject),
		);
		expect(
			target,
			"an unstarred inbox thread, the fixture this case needs",
		).toBeDefined();
		if (!target?.subject) return;

		await page.goto(`/mail/flagged/${target.threadId}/${target.messageId}`);

		const article = await settledConversation(page, target.subject);
		await expect(page.getByText("Select a thread to read")).toHaveCount(0);

		// The load did not rewrite the address back to the list, so both segments
		// are still there to share.
		await expect(page).toHaveURL(
			new RegExp(`/mail/flagged/${target.threadId}/${target.messageId}`),
		);

		// Assert again after something unrelated: the starred list arrives behind
		// the conversation, and a row it does not contain must not take the pane.
		await expect(starredRow(page, run.preFlaggedSubject).first()).toBeVisible({
			timeout: 60_000,
		});
		await expect(
			article.getByRole("heading", { name: target.subject, exact: true }),
		).toBeVisible();

		// And the verbs act on it. Move needs the account and the folder the thread
		// is filed in, which is exactly what a cold address does not carry: the
		// thread's own rows answer for it, so the button opens a real picker rather
		// than explaining it has nothing to act on. Left open — Escape is the key
		// that closes the conversation, so it is not a way to dismiss a popover.
		await page.getByRole("button", { name: "Move to mailbox" }).click();
		await expect(page.getByText(NO_THREAD_HINT)).toHaveCount(0);
		await expect(
			article.getByRole("heading", { name: target.subject, exact: true }),
		).toBeVisible();
	});

	test("a starred row opens by the same address the list links to", async ({
		page,
		run,
	}) => {
		await page.goto("/mail/flagged");
		const row = starredRow(page, run.starredElsewhereSubject).first();
		await expect(row).toBeVisible({ timeout: 60_000 });

		await row.click();
		await page.waitForURL(FLAGGED_THREAD_URL);
		const article = await settledConversation(
			page,
			run.starredElsewhereSubject,
		);

		// Assert again after something unrelated: closing walks the address back up
		// to the list, and nothing may be left matched below it.
		await expect(article).toContainText("Starred, and not in the inbox.");
		await page.goBack();
		await expect(page).not.toHaveURL(FLAGGED_THREAD_URL);
		await expect(conversation(page)).toHaveCount(0);
	});
});
