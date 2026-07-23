/**
 * Desktop shift-click range under an active filter (#142, #144).
 *
 * A filtered list is a shorter, different list than the full inbox, so the
 * range has to anchor from a row visible in it — a stale anchor from the full
 * list would build an empty or dead-end range. The fixture seeds its own
 * matching set with a distinct word so the filter narrows deterministically,
 * and deletes it afterwards so the shared serial inbox other specs count
 * exactly is left as it was. Seeding lives in `beforeAll`/`afterAll` here
 * rather than in `keyboard-and-selection.spec.ts`, whose per-test setup asserts
 * an exact inbox count that extra fixtures would break.
 */
import type { Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { readRunState } from "../src/state.js";

const rows = (page: Page) => page.locator("[data-message-row]");
const selectionCount = (page: Page) => page.getByText(/\d+ messages? selected/);

// A distinct word only these fixtures carry, so the search narrows to exactly
// the seeded set. `TAG` is the per-run bookkeeping substring for seed/cleanup.
const WORD = "rangefilterprobe";
const TAG = `rangefilter${Date.now()}`;
const RANGE_COUNT = 4;
const subjectFor = (i: number) => `${WORD} notice ${TAG} #${i}`;

test.describe("Shift-click range under a filter (#142, #144)", () => {
	// `run`/`api` are test-scoped fixtures Playwright does not hand to
	// `beforeAll`/`afterAll`, so these read the run state global setup wrote and
	// build their own client — the same pattern the escalation describe uses.
	test.beforeAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		await appendMessages(
			run.imapUser,
			Array.from({ length: RANGE_COUNT }, (_, i) => ({
				subject: subjectFor(i + 1),
			})),
		);
		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, TAG),
			(ids) => ids.length === RANGE_COUNT,
			{
				timeoutMs: 90_000,
				what: "the range-filter fixtures to finish syncing",
			},
		);
	});

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		const leftover = await api.searchMatchingMessageIds(run.inboxId, TAG);
		if (leftover.length > 0) {
			await api.deleteMessages(leftover);
			await waitFor(
				() => api.searchMatchingMessageIds(run.inboxId, TAG),
				(ids) => ids.length === 0,
				{
					timeoutMs: 60_000,
					what: "range-filter fixtures to finish deleting",
				},
			);
		}
	});

	test("the range anchors from the first visible row, not a stale full-list anchor", async ({
		page,
		run,
	}) => {
		// Narrow the inbox to the seeded set — a different, shorter list.
		await page.goto(`/mail/${run.inboxId}?q=${WORD}`);
		await expect(
			page.getByText(`${RANGE_COUNT} results for “${WORD}”`),
		).toBeVisible({ timeout: 30_000 });

		// Plain-click the first filtered row: it opens and becomes the range anchor.
		await rows(page).nth(0).click();
		await page.waitForURL(/selectedMessageId=/);

		// Shift-click the third filtered row: the range spans the visible rows,
		// anchored from the row that is actually on screen.
		await rows(page)
			.nth(2)
			.click({ modifiers: ["Shift"] });

		await expect(selectionCount(page)).toHaveText("3 messages selected");
	});
});
