/**
 * A standing filter that moves mail to an arbitrary folder must surface the
 * same "Moved by Remit" badge and Undo the classifier's Inbox/Junk moves get
 * (issue #223). Driven end to end: a real literal filter created through the
 * public API, a real message delivered and synced, the browser asserting the
 * badge and using its Undo.
 *
 * The filter is purely literal (a Subject clause), so the move fires at
 * body-sync with no vector index — the e2e lane deliberately does not build one,
 * so `/search/semantic` is never touched here.
 *
 * The scratch message is delivered to INBOX and the filter moves it to Junk, so
 * it never sits in the seeded set the other specs count. Undo returns it to
 * INBOX; `afterAll` deletes it wherever it ended and removes the filter, so the
 * shared serial inbox is left exactly as found.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { readRunState } from "../src/state.js";

const mailboxIdByPath = async (
	api: ApiClient,
	accountId: string,
	fullPath: string,
): Promise<string> => {
	const mailboxes = await waitFor(
		() => api.listMailboxes(accountId),
		(list) => list.some((mailbox) => mailbox.fullPath === fullPath),
		{ timeoutMs: 60_000, what: `the ${fullPath} mailbox to sync` },
	);
	const mailbox = mailboxes.find((entry) => entry.fullPath === fullPath);
	if (!mailbox)
		throw new Error(`unreachable: ${fullPath} matched but not found`);
	return mailbox.mailboxId;
};

test.describe("Auto-moved filter badge", () => {
	const token = `Filter move ${Date.now()}`;
	let junkId = "";
	let filterId = "";

	test.beforeAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		junkId = await mailboxIdByPath(api, run.accountId, "Junk");

		const filter = await api.createFilter(run.accountId, {
			name: `Auto-moved e2e ${token}`,
			scope: "Standing",
			literalClauses: [{ field: "Subject", value: token }],
			actionMailboxId: junkId,
		});
		filterId = filter.filterId;

		// Deliver a matching message to INBOX and sync it; the standing filter
		// moves it to Junk at body-sync and records the auto-moved marker.
		await appendMessages(run.imapUser, [
			{ subject: token, body: "Filter target." },
		]);
		await api.triggerSync(run.accountId);

		await waitFor(
			() => api.listThreads(junkId),
			(items) =>
				items.some(
					(thread) =>
						thread.subject === token &&
						thread.autoMoved?.destinationMailboxId === junkId &&
						thread.autoMoved?.filterId === filterId,
				),
			{
				timeoutMs: 90_000,
				what: `"${token}" to be filter-moved into Junk with an auto-moved marker`,
			},
		);
	});

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);

		// Remove the scratch message wherever it ended — Junk if a test bailed
		// before undoing, INBOX after a successful undo — so the exact-count INBOX
		// assertions in other specs are unaffected.
		for (const mailboxId of [junkId, run.inboxId]) {
			if (!mailboxId) continue;
			const threads = await api.listThreads(mailboxId);
			const ids = threads
				.filter((thread) => thread.subject === token)
				.map((thread) => thread.messageId);
			if (ids.length > 0) await api.deleteMessages(ids);
		}

		if (filterId) await api.deleteFilter(run.accountId, filterId);
	});

	test("the badge shows on a filter-moved message and Undo returns it", async ({
		api,
		page,
		run,
	}) => {
		await page.goto(`/mail/${junkId}`);

		const row = page.getByText(token, { exact: true }).first();
		await expect(row).toBeVisible({ timeout: 30_000 });

		// The list row carries the auto-moved badge naming the source folder.
		await expect(page.getByText(/Moved from .* by Remit/i).first()).toBeVisible(
			{ timeout: 20_000 },
		);

		await row.click();
		await page.waitForURL(/selectedMessageId=/);
		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 20_000 });

		// A filter move (unlike a classifier move) offers a link to the filter in
		// Settings from the reading-view badge — undo returns the message but never
		// disables the filter.
		await expect(
			article.getByRole("link", { name: "Manage filter" }),
		).toBeVisible();

		// The reading-view badge's Undo returns the message to its source folder.
		await article.getByRole("button", { name: "Undo", exact: true }).click();

		// The badge clears — no dismissed flag, it re-derives from the message's
		// new placement, so once the move settles the Undo affordance is gone.
		await expect(
			page.getByRole("button", { name: "Undo", exact: true }),
		).toHaveCount(0, { timeout: 20_000 });

		const junkAfter = await waitFor(
			() => api.listThreads(junkId),
			(items) => items.every((thread) => thread.subject !== token),
			{ timeoutMs: 30_000, what: `"${token}" to leave Junk` },
		);
		expect(junkAfter.filter((thread) => thread.subject === token)).toHaveLength(
			0,
		);

		const inboxAfter = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((thread) => thread.subject === token),
			{ timeoutMs: 30_000, what: `"${token}" to return to Inbox` },
		);
		const returned = inboxAfter.filter((thread) => thread.subject === token);
		expect(returned).toHaveLength(1);
		// Back in its source folder, the move is no longer in effect: the marker
		// still exists on the message, but the projection only badges it while it
		// sits in the filter's destination.
		expect(returned[0].autoMoved?.destinationMailboxId).not.toBe(
			returned[0].mailboxId,
		);
	});
});
