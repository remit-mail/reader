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
	COMPOSE_URL,
	FLAGGED_THREAD_URL,
	MAILBOX_ROW_LINK,
	MAILBOX_THREAD_URL,
	OUTBOX_MESSAGE_URL,
	OUTBOX_URL,
	REPLY_DRAFT_URL,
	REPLY_URL,
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
	// The article is the whole pane, not one slot per message, so a
	// multi-message thread renders two `.animate-pulse` skeletons. A strict
	// `toBeHidden` throws on the second, so wait for the count to hit zero.
	await expect(article.locator(".animate-pulse")).toHaveCount(0, {
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

	// Editing a draft used to set the compose flag on `/mail/outbox`, where
	// nothing mounted the surface: the press did nothing at all (#719).
	test("editing a draft opens the composer on the outbox itself", async ({
		api,
		page,
		run,
	}) => {
		await seedOutboxMessage(api, run.accountId);

		await page.goto("/mail/outbox");
		await outboxRow(page, subject).hover({ timeout: 30_000 });
		await page.getByRole("button", { name: "Edit as draft" }).first().click();

		// The message it opened on is the one that was edited, so the subject is
		// what says the surface arrived rather than a placeholder any composer has.
		const subjectField = page.locator("[data-subject-field]");
		await expect(subjectField).toHaveValue(subject, { timeout: 30_000 });
		await expect(page).toHaveURL(COMPOSE_URL);

		// Assert again after something unrelated: the outbox list settles behind
		// the composer and must not take the pane back.
		await expect(outboxRow(page, subject)).toBeVisible({ timeout: 30_000 });
		await expect(subjectField).toHaveValue(subject);
	});

	// The draft is a segment of the compose address, not a note kept beside it.
	// Held beside it, Back cleared the note and Forward re-matched compose with
	// nothing to write to: a blank composer over a draft row still on the list.
	test("the draft the composer is on survives Back and Forward", async ({
		api,
		page,
		run,
	}) => {
		const outboxMessageId = await seedOutboxMessage(api, run.accountId);

		await page.goto("/mail/outbox");
		await outboxRow(page, subject).hover({ timeout: 30_000 });
		await page.getByRole("button", { name: "Edit as draft" }).first().click();

		const subjectField = page.locator("[data-subject-field]");
		await expect(subjectField).toHaveValue(subject, { timeout: 30_000 });
		// The address says which draft, so it is shareable and it is restorable.
		await expect(page).toHaveURL(
			new RegExp(`/mail/outbox/compose/${outboxMessageId}`),
		);

		await page.goBack();
		await expect(page).toHaveURL(OUTBOX_URL);
		await expect(subjectField).toHaveCount(0);

		await page.goForward();
		await expect(page).toHaveURL(
			new RegExp(`/mail/outbox/compose/${outboxMessageId}`),
		);
		await expect(subjectField).toHaveValue(subject, { timeout: 30_000 });
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

	test("a starred row opens the same address a pasted one does", async ({
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

/**
 * The compose surface is a route as well (#719, #703).
 *
 * It used to be a flag in React state that only the mailbox route rendered
 * anything off, so Compose pressed anywhere else set a flag over a view that
 * mounted nothing — and the window then turned up on whatever navigation came
 * next. Compose is a child of each list now, so it is showing because the
 * address says so and for no other reason.
 */
test.describe("Compose lives in the address (#719)", () => {
	test.setTimeout(120_000);

	const recipients = (page: Page): Locator =>
		page.getByPlaceholder("Recipients");

	const sidebar = (page: Page): Locator =>
		page.getByRole("navigation", { name: "Mailboxes", exact: true });

	test("c on the brief opens it there, rather than carrying the reader off", async ({
		page,
		run,
	}) => {
		await page.goto("/mail/brief");
		await expect(sidebar(page)).toBeVisible({ timeout: 20_000 });

		await page.keyboard.press("c");

		await expect(recipients(page)).toBeVisible({ timeout: 30_000 });
		await expect(page).toHaveURL(/\/mail\/brief\/compose/);

		// Assert again after something unrelated: the brief's own rows arrive
		// behind the surface, and none of them may take the pane back.
		await expect(briefRow(page, run.seededSubjects[0])).toBeVisible({
			timeout: 60_000,
		});
		await expect(recipients(page)).toBeVisible();
		await expect(page).toHaveURL(COMPOSE_URL);
	});

	test("a query typed over the composer leaves it standing", async ({
		page,
		run,
	}) => {
		await openBrief(page, run.seededSubjects[0]);
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		await expect(recipients(page)).toBeVisible({ timeout: 30_000 });

		// Searching is what used to summon the queued surface. An unsent message is
		// not the pre-search list's leftover, so the query narrows the list behind
		// it and the composer stays.
		const field = searchField(page);
		await field.click();
		await field.pressSequentially("invoice");
		await page.waitForURL(/[?&]q=invoice/);

		await expect(field).toHaveValue("invoice");
		await expect(recipients(page)).toHaveCount(1);
		await expect(page).toHaveURL(COMPOSE_URL);
	});

	// #835: the writing surface loads on its own chunk, and on a cold cache that
	// chunk lands while the reader is already typing in the search field. The
	// editor must arrive without claiming the caret — every character goes where
	// the reader put it, and the body never becomes the active element.
	test("the editor arriving mid-word leaves the search field alone", async ({
		page,
		run,
	}) => {
		// Hold the lazy chunk until the reader is mid-word, then release it into
		// the middle of the query — the exact timing CI hit, made deterministic.
		// Bounded so a failed expect below can't strand this spinning forever in
		// a serial suite.
		let release = false;
		let interceptions = 0;
		const deadline = Date.now() + 60_000;

		await openBrief(page, run.seededSubjects[0]);
		// Registered only once the shell has loaded: its eager modules ride the
		// same names, and holding those would hold the page itself.
		await page.route(/rich-text/, async (route) => {
			interceptions++;
			while (!release && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}
			await route.continue();
		});

		try {
			await page.getByRole("button", { name: "Compose", exact: true }).click();
			const field = searchField(page);
			await expect(recipients(page)).toBeVisible({ timeout: 30_000 });

			await field.click();
			await field.pressSequentially("invo", { delay: 100 });

			const body = page.locator("[data-testid=compose-body]");
			// If the built chunk stops matching /rich-text/ (the image lane runs
			// hashed rollup output) the hold silently no-ops — fail loudly here
			// instead of degrading into a duplicate of the test above.
			expect(interceptions).toBeGreaterThan(0);
			await expect(body).toBeHidden();

			release = true;
			// Wait for the surface to actually land before typing the rest of the
			// word, so the steal window provably overlaps typing.
			await expect(body).toBeVisible({ timeout: 30_000 });
			await field.pressSequentially("ice", { delay: 100 });
			await page.waitForURL(/[?&]q=invoice/);

			await expect(field).toHaveValue("invoice");
			await expect(page).toHaveURL(COMPOSE_URL);
			await expect(field).toBeFocused();
		} finally {
			await page.unroute(/rich-text/);
		}
	});

	test("back unwinds one surface per press", async ({ page, run }) => {
		const subject = run.seededSubjects[0];
		await openBrief(page, subject);
		await briefRow(page, subject).click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await settledConversation(page, subject);

		await page.getByRole("button", { name: "Compose", exact: true }).click();
		await expect(recipients(page)).toBeVisible({ timeout: 30_000 });
		await expect(page).toHaveURL(COMPOSE_URL);
		// One surface at a time: the conversation is not waiting behind it to be
		// revealed by the next keystroke.
		await expect(conversation(page)).toHaveCount(0);

		await page.goBack();
		await expect(page).toHaveURL(BRIEF_THREAD_URL);
		await expect(recipients(page)).toHaveCount(0);
		await settledConversation(page, subject);

		await page.goBack();
		await expect(page).toHaveURL(BRIEF_URL);
		await expect(conversation(page)).toHaveCount(0);
	});

	// The top bar keeps Compose on screen while the reader is composing, so the
	// press has to start a second message rather than leave the first one on
	// screen under an address that says otherwise.
	test("pressing Compose while composing starts a new message", async ({
		page,
		run,
	}) => {
		await page.goto("/mail/brief");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		// A recipient first: the outbox refuses a draft addressed to nobody, so a
		// subject on its own never becomes the draft this case is about.
		const recipientsField = recipients(page);
		await expect(recipientsField).toBeVisible({ timeout: 30_000 });
		await recipientsField.fill("ada@remit.test");
		await recipientsField.press("Enter");

		const subjectField = page.locator("[data-subject-field]");
		await subjectField.fill("First message");

		// The autosave writes the draft and the address takes its id, which is the
		// state the second press has to undo.
		await page.waitForURL(/\/mail\/brief\/compose\/[^/?#]+/, {
			timeout: 30_000,
		});

		await page.getByRole("button", { name: "Compose", exact: true }).click();

		await expect(page).toHaveURL(/\/mail\/brief\/compose$/);
		await expect(subjectField).toHaveValue("");
		await expect(recipients(page)).toBeVisible();

		// Assert again after something unrelated: the brief settles behind the
		// composer, and the draft that was open does not come back with it.
		await expect(briefRow(page, run.seededSubjects[0])).toBeVisible({
			timeout: 30_000,
		});
		await expect(subjectField).toHaveValue("");
	});
});

/**
 * A reply and a new message are two composers, and the draft each is writing
 * belongs to the one writing it (#719).
 *
 * They used to share one: the reply's first autosave wrote its id into a
 * provider every composer read, so the next new message opened on the reply.
 * Worse if the reply had been sent by then — the composer loaded a queued
 * outbox row and autosave went on writing to it, which is #604 again.
 */
test.describe("One composer's draft is not another's (#719)", () => {
	test.setTimeout(120_000);

	test("a reply's draft does not follow the next new message", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openBrief(page, subject);
		await briefRow(page, subject).click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await settledConversation(page, subject);

		await page.getByRole("button", { name: "Reply", exact: true }).click();
		const subjectField = page.locator("[data-subject-field]");
		await expect(subjectField).toHaveValue(/^Re: /, { timeout: 30_000 });

		// The draft has to exist for it to be inherited, so the save lands first.
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Yes, that works.");
		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});

		// Compose takes the pane off the reply. A new message is new: no subject
		// carried over, and no draft in the address for one to be loaded from.
		await page.getByRole("button", { name: "Compose", exact: true }).click();
		await expect(page.getByPlaceholder("Recipients")).toBeVisible({
			timeout: 30_000,
		});
		await expect(page).toHaveURL(/\/mail\/brief\/compose$/);
		await expect(subjectField).toHaveValue("");

		// Assert again once everything behind it has settled: the reply's draft
		// arriving late is exactly the shape this test exists for.
		await expect(briefRow(page, subject)).toBeVisible({ timeout: 30_000 });
		await expect(subjectField).toHaveValue("");
	});
});

/**
 * A reply is a segment under the message it answers (#720).
 *
 * It used to be React state inside the conversation, raised by a request prop
 * the toolbar set and the conversation consumed a render later. Nothing about
 * it was in the address, so it could not be shared, could not survive a reload,
 * and the request could still be standing when the thread it was aimed at had
 * gone. The mode and the message are segments now, so a reply cannot exist
 * without a source, and leaving the conversation leaves the reply with it.
 */
test.describe("A reply lives under its message (#720)", () => {
	test.setTimeout(120_000);

	const replySubject = (page: Page): Locator =>
		page.locator("[data-subject-field]");

	/** The chips in an address field, one per recipient the message carries. */
	const recipients = (page: Page, field: string): Locator =>
		page.locator(`[data-address-field="${field}"]`).getByRole("button", {
			name: /^Remove /,
		});

	const openReply = async (page: Page, subject: string): Promise<void> => {
		await openBrief(page, subject);
		await briefRow(page, subject).click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await settledConversation(page, subject);
		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(replySubject(page)).toHaveValue(/^Re: /, { timeout: 30_000 });
	};

	test.afterEach(async ({ api, run }) => {
		const answered = run.seededSubjects[0];
		for (const entry of await api.listRemovableOutboxMessages()) {
			if (
				entry.subject.startsWith(`Re: ${answered}`) ||
				entry.subject.startsWith(`Fwd: ${answered}`)
			) {
				await api.deleteOutboxMessage(entry.outboxMessageId);
			}
		}
	});

	test("a reply cannot outlive the thread it answers", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		const elsewhere = run.seededSubjects[1];

		await openBrief(page, subject);
		await briefRow(page, subject).click();
		await page.waitForURL(BRIEF_THREAD_URL);
		await settledConversation(page, subject);
		const message = new URL(page.url()).pathname;

		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(replySubject(page)).toHaveValue(/^Re: /, { timeout: 30_000 });

		// Under the message rather than beside it: the address the conversation
		// was already on is the prefix, so the source is a fact of the path.
		await expect(page).toHaveURL(new RegExp(`${message}/reply`));
		await expect(page).toHaveURL(REPLY_URL);
		await expect(conversation(page)).toBeVisible();

		// Assert again after something unrelated: the brief settles behind the
		// reply, and none of its rows may take the pane back.
		await expect(briefRow(page, subject)).toBeVisible({ timeout: 30_000 });
		await expect(replySubject(page)).toHaveValue(/^Re: /);

		// Another conversation unmatches the reply in the same transition, so
		// there is nothing left over to be revealed by a later keystroke.
		await briefRow(page, elsewhere).click();
		await settledConversation(page, elsewhere);
		await expect(replySubject(page)).toHaveCount(0);
		await expect(page).not.toHaveURL(REPLY_URL);

		// And back to the thread that was being answered: no orphan composer over
		// a conversation whose address says nothing is being written.
		await briefRow(page, subject).click();
		await settledConversation(page, subject);
		await expect(replySubject(page)).toHaveCount(0);
		await expect(page).not.toHaveURL(REPLY_URL);
	});

	test("the draft a reply is writing is the segment under it", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openReply(page, subject);

		const written = `Answered at ${Date.now()}.`;
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(written);
		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});

		// The id the autosave created is recorded under the reply rather than as a
		// route of its own, so the address gains a segment while the composer keeps
		// what is in it — a child route would have taken the caret out of the
		// sentence being typed.
		await page.waitForURL(REPLY_DRAFT_URL, { timeout: 30_000 });
		await expect(page.getByTestId("compose-body")).toContainText(written);

		const draftAddress = page.url();
		await page.reload();

		// Cold, from the address alone: the same reply on the same draft, rather
		// than a blank one beside a draft row nothing points at.
		await expect(page.getByTestId("compose-body")).toContainText(written, {
			timeout: 30_000,
		});
		await expect(replySubject(page)).toHaveValue(/^Re: /);
		await expect(page).toHaveURL(draftAddress);
	});

	/**
	 * The draft segment travels when the mode changes. Reply All over a reply is
	 * the same message being written — the recipients change and the text does
	 * not — so an address that dropped the draft would say "another document" to
	 * the composer, which blanks the fields and leaves what was typed reachable
	 * only from the Outbox.
	 */
	test("answering again keeps what is already written", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openReply(page, subject);

		const written = `Still writing at ${Date.now()}.`;
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(written);
		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});
		await page.waitForURL(REPLY_DRAFT_URL, { timeout: 30_000 });
		const draft = new URL(page.url()).pathname.split("/").pop();

		await page.getByRole("button", { name: "Reply all", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/reply-all/${draft}(\\?|#|$)`));
		await expect(page.getByTestId("compose-body")).toContainText(written);
		await expect(replySubject(page)).toHaveValue(/^Re: /);

		// Forward is the same move again, and it does change something: the
		// subject. What was written into the message is not it.
		await page.getByRole("button", { name: "Forward", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/forward/${draft}(\\?|#|$)`));
		await expect(replySubject(page)).toHaveValue(/^Fwd: /);
		await expect(page.getByTestId("compose-body")).toContainText(written);

		// Assert again after something unrelated: the brief settles behind the
		// composer, and pressing the verb the address already names leaves the
		// message being written exactly as it is.
		await expect(briefRow(page, subject)).toBeVisible({ timeout: 30_000 });
		await page.getByRole("button", { name: "Forward", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/forward/${draft}(\\?|#|$)`));
		await expect(page.getByTestId("compose-body")).toContainText(written);
	});

	/**
	 * A forward is addressed to nobody (#797). The reply branch fills To with the
	 * person being answered, and the draft travels with the mode, so a forward
	 * that only rewrote the subject sent the conversation straight back to them
	 * unless the reader noticed the field.
	 */
	test("forwarding a reply drops the person it was answering", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openReply(page, subject);

		// The reply is addressed before anything is typed, which is the state the
		// forward has to clear rather than carry.
		await expect(recipients(page, "To")).not.toHaveCount(0);

		await page.getByRole("button", { name: "Forward", exact: true }).click();
		await expect(replySubject(page)).toHaveValue(/^Fwd: /);
		await expect(recipients(page, "To")).toHaveCount(0);

		// Assert again after something unrelated: the brief settles behind the
		// composer, and nothing arriving late re-addresses the forward.
		await expect(briefRow(page, subject)).toBeVisible({ timeout: 30_000 });
		await expect(recipients(page, "To")).toHaveCount(0);

		// Back to Reply and the answer is addressed again, so the empty field is
		// the forward's doing rather than a composer that stopped filling it.
		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(replySubject(page)).toHaveValue(/^Re: /);
		await expect(recipients(page, "To")).not.toHaveCount(0);
	});

	/**
	 * The list is still mounted beside the reply, and its keyboard layer answers
	 * the row its own cursor is on. Left running, r restarts the reply on screen
	 * — and after a k, aims one at a different conversation entirely.
	 */
	test("the list's keyboard leaves an open reply alone", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openReply(page, subject);

		const written = `Half a sentence ${Date.now()}.`;
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(written);
		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});
		await page.waitForURL(REPLY_DRAFT_URL, { timeout: 30_000 });
		const replying = page.url();

		// Out of the editor, which is where the list's keys reach the window
		// again: the reader clicked the conversation to read the turn they are
		// answering.
		await conversation(page)
			.getByRole("heading", { name: subject, exact: true })
			.click();
		await page.keyboard.press("k");
		await page.keyboard.press("r");

		await expect(page).toHaveURL(replying);
		await expect(page.getByTestId("compose-body")).toContainText(written);
		await expect(replySubject(page)).toHaveValue(/^Re: /);
	});

	/**
	 * A query going active closes the reading pane, because a message opened from
	 * the pre-search list is not in the result set. A reply is not that leftover:
	 * it is the reader's own unsent message, so the query narrows the list behind
	 * it and what is being written stays on screen.
	 */
	test("a query typed over the reply leaves it standing", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await openReply(page, subject);

		const written = `Typed before searching ${Date.now()}.`;
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(written);
		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});
		await page.waitForURL(REPLY_DRAFT_URL, { timeout: 30_000 });
		const replying = new URL(page.url()).pathname;

		const field = searchField(page);
		await field.click();
		await field.pressSequentially("invoice");
		await page.waitForURL(/[?&]q=invoice/);

		// The query landed on the address the reply is already at, rather than on
		// the bare list with the reply dropped off the end of it.
		await expect(field).toHaveValue("invoice");
		await expect(page).toHaveURL(REPLY_URL);
		expect(new URL(page.url()).pathname).toBe(replying);
		await expect(replySubject(page)).toHaveValue(/^Re: /);
		await expect(page.getByTestId("compose-body")).toContainText(written);
	});

	/**
	 * The phone is where the reply route mounting nothing is load-bearing: there
	 * is no reading slot for an `Outlet` to fill, so the conversation is the
	 * single pane and it renders the composer off the address itself.
	 */
	test.describe("On a phone", () => {
		test.use({ viewport: { width: 390, height: 844 } });

		test("a message's own Reply opens the composer in the conversation", async ({
			page,
			run,
		}) => {
			const subject = run.seededSubjects[0];
			await openBrief(page, subject);
			await briefRow(page, subject).click();
			await page.waitForURL(BRIEF_THREAD_URL);

			// The verb belongs to the message it sits under, so the address names
			// that message and the composer answers it.
			await page
				.getByRole("button", { name: "Reply", exact: true })
				.first()
				.click();

			await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /, {
				timeout: 30_000,
			});
			await expect(page).toHaveURL(REPLY_URL);

			// Assert again after something unrelated: the conversation is still
			// under the reply, and the brief has not taken the pane back.
			await expect(page.getByTestId("conversation-messages")).toBeVisible();
			await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /);
			await expect(page).toHaveURL(REPLY_URL);
		});
	});
});
