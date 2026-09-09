/**
 * Refresh and the once-a-minute new-mail poll (#582).
 *
 * Mail that lands on the server through some path other than this browser tab
 * — another device, the scheduler, an earlier `triggerSync` — must still reach
 * this tab. The background poll is what notices, and it does two things with
 * that: it lights the control's "new mail" state, and it reloads the listing
 * of the folder whose total moved, since a message already on our side costs
 * nothing more to show. The press is still what drives a sync round of its own
 * and what clears the dot.
 */
import type { Locator, Page } from "@playwright/test";
import { type AccountSyncStatus, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, waitForServerMailbox } from "../src/imap.js";

const DESKTOP = { width: 1512, height: 864 };

const messageRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

/** The phases the worker writes while a sync round is actually running. */
const SYNC_IN_PROGRESS = new Set([
	"discovering_mailboxes",
	"syncing_inbox",
	"syncing_others",
]);

const inboxLastSyncedAt = (
	status: AccountSyncStatus,
	inboxId: string,
): number =>
	status.mailboxes.find((mailbox) => mailbox.mailboxId === inboxId)
		?.lastSyncedAt ?? 0;

// Scoped to the mailbox pane's own header (`SelectionTopBar`, rendered
// `data-selection-bar`) so this never matches the shell's global refresh,
// which carries the same "Refresh…" name prefix.
const listRefreshButton = (page: Page): Locator =>
	page.locator("header[data-selection-bar]").getByRole("button", {
		name: /^Refresh/,
	});

test.describe("Mail refresh (#582)", () => {
	test.use({ viewport: DESKTOP });

	const tag = `refresh${Date.now()}`;

	// The wait is on Dovecot: a delete is answered off the read model and pushed
	// to IMAP behind it, and a later spec's sync re-derives the inbox from the
	// server — so a scratch message still there comes back.
	test.afterEach(async ({ api, run }) => {
		const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
		if (leftover.length > 0) await api.deleteMessages(leftover);
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.some((subject) => subject.includes(tag)),
			{ what: `the ${tag} fixtures to leave the inbox` },
		);
	});

	test("clicking the inbox's refresh control drives a real sync round to completion and surfaces the result", async ({
		page,
		api,
		run,
	}) => {
		// A first paint, a full sync round and the cleanup's wait on Dovecot all
		// come out of one budget, and the suite's 60s default does not hold all
		// three when the round is slow.
		test.setTimeout(180_000);

		await page.goto(`/mail/${run.inboxId}`);
		await expect(messageRow(page, run.seededSubjects[0])).toBeVisible({
			timeout: 20_000,
		});

		// Two rounds can still be in flight here: the setup's own, whose gate only
		// waited for the INBOX row to exist rather than for every folder to settle,
		// and the one the load above triggered off `GET /config`, which the e2e
		// freshness window is too short to gate. A refresh clicked while either is
		// mid-flight can be "confirmed" by that round settling instead of by the
		// one the click enqueued: the control reports done, invalidates the list,
		// and the list refetch lands before the appended message has synced — the
		// row never arrives within the window (#761). Waiting here, after the load
		// and before the append, for the server to report no round in flight makes
		// the click's round unambiguous; this is the explicit wait half of the
		// wait-or-reconcile decision (docs/architecture/imap-mutations.md), taken
		// here rather than in the client because the tab cannot distinguish rounds
		// from the status endpoint alone.
		await waitFor(
			() => api.getSyncStatus(run.accountId),
			(status: AccountSyncStatus) =>
				!SYNC_IN_PROGRESS.has(status.syncPhase ?? "idle"),
			{
				timeoutMs: 45_000,
				what: "any earlier sync round to settle before the click",
			},
		);

		const subject = `Refresh manual ${tag}`;
		// Appended on the server only — nothing here calls the sync API first,
		// so the click below has to do the whole job itself: enqueue the round,
		// wait for the server to actually finish it, then reveal the result.
		// A click that reports done before the round ran would pass a version
		// of this test that pre-synced first; this one does not give it that
		// shortcut.
		await appendMessages(run.imapUser, [
			{ subject, body: "Arrived through another path." },
		]);

		// Checked immediately, before the tab's own poll can have had a tick on
		// mail appended a moment ago: nothing has asked for this row yet. What
		// the click has to prove is that it drives the round itself, not that
		// the row could never have arrived another way — the poll test below
		// pins that other way.
		await expect(messageRow(page, subject)).toHaveCount(0);

		await listRefreshButton(page).click();
		await expect(messageRow(page, subject)).toBeVisible({ timeout: 30_000 });
	});

	test("mail synced through another path surfaces on its own, and the press acknowledges it", async ({
		page,
		api,
		run,
	}) => {
		// The poll this asserts on runs once a minute; nothing in this test may
		// go faster than that without lying about what it proves. What it costs
		// instead is time: the waits below add up to two poll periods plus the
		// sync round on either side of them, and the cleanup this test shares a
		// budget with waits on Dovecot too.
		test.setTimeout(240_000);

		// The tab takes its "what did this mailbox hold" baseline from the first
		// sync status it reads, and that status is the last round's record of the
		// server rather than the read model — a message deleted since that round
		// is still counted in it. Left alone, the baseline can therefore already
		// include a message this test's append then replaces, and a total that
		// ends where it started is not new mail. Run a round before the tab opens
		// so the baseline it takes is the mailbox as the server has it, leaving
		// the append below as the only thing that can move the total.
		const cursor = await api
			.getSyncStatus(run.accountId)
			.then((status) => inboxLastSyncedAt(status, run.inboxId));
		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.getSyncStatus(run.accountId),
			(status) => inboxLastSyncedAt(status, run.inboxId) > cursor,
			{
				timeoutMs: 30_000,
				what: "a sync round to record the inbox as the server now has it",
			},
		);

		await page.goto(`/mail/${run.inboxId}`);
		await expect(messageRow(page, run.seededSubjects[0])).toBeVisible({
			timeout: 20_000,
		});

		const subject = `Refresh poll ${tag}`;
		await appendMessages(run.imapUser, [
			{ subject, body: "Arrived while the tab sat open." },
		]);
		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((thread) => thread.subject === subject),
			{
				timeoutMs: 15_000,
				what: `the appended message "${subject}" to sync server-side`,
			},
		);

		// Nothing in the tab reloaded or was clicked between the append above
		// and these assertions — the once-a-minute poll is the only thing that
		// can have noticed the mailbox moved. A message already synced to our
		// side costs nothing more to show, so the tick that sees the total move
		// reloads that folder's listing rather than making the reader ask for
		// what we already hold.
		//
		// The window is two poll periods wide because the tab's poll and the
		// append are unrelated clocks: mail landing a moment after one tick
		// waits out the whole of the next, and the tick that lands mid-round can
		// read totals the round has not written yet. One period holds only when
		// the timing is kind, which is a coin toss dressed up as an assertion.
		await expect(messageRow(page, subject)).toBeVisible({ timeout: 135_000 });
		await expect(listRefreshButton(page)).toHaveAccessibleName(/new mail/);

		// The dot is still the account-level signal and still sticky: showing
		// the row does not clear it, only the press does. That press is also
		// still a real sync round — it settles, and leaves the mail it was
		// pressed for on screen.
		await listRefreshButton(page).click();
		await expect(listRefreshButton(page)).not.toHaveAccessibleName(/new mail/, {
			timeout: 60_000,
		});
		await expect(messageRow(page, subject)).toBeVisible();
	});
});
