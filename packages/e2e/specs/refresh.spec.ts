/**
 * Refresh and the once-a-minute new-mail poll (#582).
 *
 * Mail that lands on the server through some path other than this browser tab
 * — another device, the scheduler, an earlier `triggerSync` — must still reach
 * this tab: the background poll notices it and the refresh control surfaces
 * it. Neither loads the heavy message list on its own; the poll only lights
 * the control's "new mail" state, and the list itself only changes once the
 * control is clicked.
 */
import type { Locator, Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";

const DESKTOP = { width: 1512, height: 864 };

const messageRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

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

	test.afterEach(async ({ api, run }) => {
		const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
		if (leftover.length > 0) await api.deleteMessages(leftover);
	});

	test("clicking the inbox's refresh control drives a real sync round to completion and surfaces the result", async ({
		page,
		run,
	}) => {
		await page.goto(`/mail/${run.inboxId}`);
		await expect(messageRow(page, run.seededSubjects[0])).toBeVisible({
			timeout: 20_000,
		});

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

		// The heavy list query never refetches on its own — the row it would
		// contain is not on screen until something asks for it.
		await expect(messageRow(page, subject)).toHaveCount(0);

		await listRefreshButton(page).click();
		await expect(messageRow(page, subject)).toBeVisible({ timeout: 30_000 });
	});

	test("the background poll notices mail synced through another path and the refresh control surfaces it", async ({
		page,
		api,
		run,
	}) => {
		// The poll this asserts on runs once a minute; nothing in this test may
		// go faster than that without lying about what it proves.
		test.setTimeout(120_000);

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
		// and this assertion — the once-a-minute poll is the only thing that
		// can have noticed the mailbox moved.
		await expect(listRefreshButton(page)).toHaveAccessibleName(/new mail/, {
			timeout: 75_000,
		});
		await expect(messageRow(page, subject)).toHaveCount(0);

		await listRefreshButton(page).click();
		await expect(messageRow(page, subject)).toBeVisible({ timeout: 15_000 });
	});
});
