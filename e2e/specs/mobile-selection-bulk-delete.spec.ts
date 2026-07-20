/**
 * Mobile selection mode and search-scoped bulk delete (issue #92).
 *
 * The driving case the issue names: search "npm", long-press into selection
 * mode, select everything that matches, delete it. The highest-value claim in
 * this file is that the count the UI shows always matches what actually gets
 * removed — every delete here is verified against the real backend (message
 * ids paged over the API, or subjects read straight off IMAP), never against
 * UI text alone.
 *
 * Two things this harness cannot reproduce cheaply are worked around
 * deliberately, both noted where they're used:
 *
 * - The "search has more matches than are loaded" affordance only appears once
 *   a mailbox search's first (unbounded) page comes back with a
 *   `continuationToken` — which needs >500 real matching messages, since that
 *   is the server's default page size (`THREAD_SEARCH_MAX_LIMIT`). Seeding
 *   500+ IMAP messages just to flip one boolean is wasteful, so the
 *   escalation-availability trigger is forced via `page.route`, injecting a
 *   `continuationToken` into that one response. Everything downstream —
 *   `escalate()`'s own counting (a *different* request, paged at limit=100)
 *   and the delete it drives — is completely real against the messages seeded
 *   below and is never touched by the mock.
 * - Partial failure is simulated by mocking the bulk-delete endpoint's first
 *   response (the boundary the brief calls out) — the ids it reports failed
 *   are read back out of the real outgoing request, and Retry's follow-up call
 *   is left unmocked, so it actually deletes them.
 */
import type { Locator, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { readRunState } from "../src/state.js";

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE });

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/**
 * Simulates a long press with real pointer events (not a synthetic touch), the
 * same input `ui/swipeable-row.tsx`'s own 500ms timer listens for. Chromium
 * dispatches PointerEvents for mouse input, which is what the row's
 * `onPointerDown`/`onPointerUp` handlers are wired to.
 */
const longPress = async (page: Page, row: Locator): Promise<void> => {
	const box = await row.boundingBox();
	if (!box) throw new Error("row has no bounding box to long-press");
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.waitForTimeout(650);
	await page.mouse.up();
};

/**
 * The idle-state entry affordance nested in each row's leading avatar slot
 * (`ui/swipeable-row.tsx`): a real `role="checkbox"` button, reachable without
 * a long press.
 */
const entryToggle = (row: Locator): Locator => row.getByRole("checkbox");

/**
 * Once selection mode is active, the row swaps to `MessageListItem` (the same
 * component desktop uses) and the leading slot becomes a plain button — not
 * `role="checkbox"` — labelled "Select message" / "Deselect message".
 */
const rowToggle = (row: Locator): Locator =>
	row.getByRole("button", { name: /^(Select|Deselect) message$/ });

/** The mobile selection bar, identified by its one unambiguous control. */
const selectionBar = (page: Page): Locator =>
	page
		.locator("header")
		.filter({ has: page.getByRole("button", { name: "Cancel selection" }) });

const cancelSelectionButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Cancel selection" });

const deleteButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages to Trash" });

const selectAllCheckbox = (page: Page): Locator =>
	page.getByRole("checkbox", { name: "Select all" });

/**
 * The bar's count label and its notice banner are both `role="status"`
 * (`selection-top-bar.tsx`); the count label renders first, the notice — when
 * present — second.
 */
const selectionStatus = (page: Page): Locator =>
	selectionBar(page).getByRole("status").first();
const selectionNotice = (page: Page): Locator =>
	selectionBar(page).getByRole("status").nth(1);

const confirmDialog = (page: Page): Locator => page.getByRole("dialog");

const gotoInbox = async (page: Page, mailboxId: string): Promise<void> => {
	await page.goto(`/mail/${mailboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

/**
 * On phone, tapping the header's search button opens a full-screen takeover
 * (`MobileSearchView`) that only ever shows the instant "Top matches" /
 * "Related" result rows — it has no submit action that hands off to the real,
 * selectable `MessageList` (`packages/web-client/src/components/mail/MailListHeader.tsx`
 * renders the takeover in place of `children`, unconditionally, for as long as
 * `searchOpen` is true). A URL that already carries `q=` arrives with the
 * takeover closed and the real filtered list rendered directly — the same
 * entry point `mailbox-navigation.spec.ts` uses — so this drives search that
 * way rather than through the takeover UI.
 */
const gotoSearch = async (
	page: Page,
	mailboxId: string,
	query: string,
): Promise<void> => {
	await page.goto(`/mail/${mailboxId}?q=${encodeURIComponent(query)}`);
	await expect(page.getByRole("textbox", { name: "Search mail" })).toBeHidden();
};

/**
 * Waits for the search results header's count (`MessageList.tsx`'s
 * `SearchResultsHeader`, driven by `threads.length` — every row the list has
 * actually fetched) to reach `count`. `[data-message-row]`'s own count is NOT
 * a substitute for this once a result set is larger than roughly a screenful:
 * `@tanstack/react-virtual` only mounts DOM nodes for rows in or near the
 * viewport, so `rows(page)` plateaus at whatever fits on screen (~15-20 rows
 * on this viewport) regardless of how many are actually loaded and selectable
 * — bounded select-all still selects every loaded row (`orderedIds` reads the
 * full `threads` array, not the DOM), so the count below, not a DOM row
 * count, is what proves the list truly loaded all of them.
 */
const expectSearchResultsCount = async (
	page: Page,
	query: string,
	count: number,
): Promise<void> => {
	await expect(
		page.getByText(
			`${count} ${count === 1 ? "result" : "results"} for “${query}”`,
		),
	).toBeVisible({ timeout: 30_000 });
};

/**
 * Forces `hasMore` true for one mailbox search term without seeding the 500+
 * real messages that would trigger it honestly (see file header). Only the
 * general, unbounded list request for the given query is touched — identified
 * by having no `limit` param, which is how `MailboxPane`'s browsing query
 * (unlike `useEscalatedDelete`'s own 100-id-paged counting/delete requests)
 * calls the endpoint. Real items from the real backend are left untouched;
 * only a `continuationToken` is added when the response didn't already carry
 * one.
 */
const forceMoreMatchesThanLoaded = async (
	page: Page,
	query: string,
): Promise<void> => {
	await page.route("**/threads/search?*", async (route) => {
		const url = new URL(route.request().url());
		if (
			url.searchParams.has("limit") ||
			url.searchParams.get("query") !== query
		) {
			await route.continue();
			return;
		}
		const response = await route.fetch();
		const json = await response.json();
		if (!json.continuationToken) {
			json.continuationToken = "e2e-forced-has-more";
		}
		await route.fulfill({ response, json });
	});
};

test.describe("Entering selection mode", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
			timeout: 30_000,
		});
	});

	test("long-press on a row enters selection mode and selects that row", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());

		await expect(selectionBar(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("1 message selected");
		// The long-pressed row itself is the one that got selected.
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
	});

	test("a short tap still opens the message outside selection mode", async ({
		page,
	}) => {
		await rows(page).first().click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(selectionBar(page)).toBeHidden();
	});

	test("avatar tap enters selection mode — long-press is not the only way in", async ({
		page,
	}) => {
		await entryToggle(rows(page).first()).click();

		await expect(selectionBar(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("1 message selected");
	});

	test("in selection mode, tapping a row's toggle affordance selects and deselects it", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());
		await expect(selectionStatus(page)).toHaveText("1 message selected");

		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");

		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionStatus(page)).toHaveText("1 message selected");
	});

	test("in selection mode, a plain tap on the row body toggles it instead of opening the message", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());
		await expect(selectionStatus(page)).toHaveText("1 message selected");

		// A tap on the row itself (not the dedicated toggle button) must behave
		// the same as tapping the toggle: select the row, never navigate.
		await rows(page).nth(1).click();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(page).not.toHaveURL(/selectedMessageId=/);
		await expect(rowToggle(rows(page).nth(1))).toHaveAccessibleName(
			"Deselect message",
		);

		await rows(page).nth(1).click();
		await expect(selectionStatus(page)).toHaveText("1 message selected");
		await expect(page).not.toHaveURL(/selectedMessageId=/);
	});

	test("swipe actions are suppressed while selection mode is active", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());
		await expect(selectionStatus(page)).toHaveText("1 message selected");

		// The same horizontal drag that reveals a swipe action outside selection
		// mode (ui/swipeable-row.tsx's SWIPE_AXIS_THRESHOLD is 10px).
		const row = rows(page).nth(1);
		const box = await row.boundingBox();
		if (!box) throw new Error("row has no bounding box");
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + box.width - 10, y);
		await page.mouse.down();
		await page.mouse.move(box.x + 10, y, { steps: 10 });
		await page.mouse.up();

		await expect(
			page.getByRole("button", { name: "Delete message" }),
		).toBeHidden();
		await expect(
			page.getByRole("button", { name: /Mark as (un)?read/ }),
		).toBeHidden();
		// The drag didn't fall through to a toggle either — selection mode
		// renders no swipe gesture surface at all (it's a different component,
		// MessageListItem, not SwipeableRow — see the file header).
		await expect(selectionStatus(page)).toHaveText("1 message selected");
	});
});

test.describe("Bounded select-all", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
			timeout: 30_000,
		});
	});

	test("select-all ticks every loaded row and names the loaded scope, never a bare count", async ({
		page,
		run,
	}) => {
		await longPress(page, rows(page).first());
		await selectAllCheckbox(page).click();

		await expect(selectionStatus(page)).toHaveText(
			`All ${run.seededSubjects.length} loaded selected`,
		);
	});

	test("the X clears the selection", async ({ page }) => {
		await longPress(page, rows(page).first());
		await expect(selectionBar(page)).toBeVisible();

		await cancelSelectionButton(page).click();

		await expect(selectionBar(page)).toBeHidden();
	});

	test("deselecting the last row exits selection mode automatically", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());
		await expect(selectionStatus(page)).toHaveText("1 message selected");

		await rowToggle(rows(page).first()).click();

		await expect(selectionBar(page)).toBeHidden();
	});
});

test.describe("Confirm dialog", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
			timeout: 30_000,
		});
	});

	test("shows the count and the Move-to-Trash wording; cancelling deletes nothing", async ({
		page,
		run,
	}) => {
		await longPress(page, rows(page).first());
		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");

		await deleteButton(page).click();

		const dialog = confirmDialog(page);
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAccessibleName("Move 2 messages to Trash?");
		await expect(
			dialog.getByText("You can restore them from Trash later."),
		).toBeVisible();

		await dialog.getByRole("button", { name: "Cancel" }).click();

		await expect(dialog).toBeHidden();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
	});

	test("completing a delete exits selection mode and actually removes the row", async ({
		page,
		run,
		api,
	}) => {
		// A scratch message, not one of the globally seeded ones: the suite runs
		// serially over one shared mailbox and other specs assert the inbox holds
		// exactly `seededSubjects` — this appends one, deletes it through the UI,
		// and the count below is what proves the baseline is restored.
		const subject = `Selection-mode exit scratch ${Date.now()}`;
		await appendMessages(run.imapUser, [{ subject }]);
		await api.triggerSync(run.accountId);

		const withExtra = run.seededSubjects.length + 1;
		await expect(async () => {
			await page.reload();
			await expect(rows(page)).toHaveCount(withExtra, { timeout: 5_000 });
		}).toPass({ timeout: 60_000 });

		const target = page
			.locator("[data-message-row]")
			.filter({ hasText: subject });
		await longPress(page, target);
		await expect(selectionStatus(page)).toHaveText("1 message selected");

		await deleteButton(page).click();
		await confirmDialog(page)
			.getByRole("button", { name: "Move to Trash" })
			.click();

		await expect(selectionBar(page)).toBeHidden();

		// A completed delete moves the roving cursor to the next surviving row
		// and opens it (existing behavior, not specific to selection mode: mobile
		// has no separate reading pane, so that navigation swaps the list out for
		// the conversation view). Back to the list to see the row count.
		await page.getByRole("button", { name: "Back to messages" }).click();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
		await expect(page.getByText(subject, { exact: true })).toBeHidden();
	});
});

test.describe("Search-scoped escalation and bulk delete", () => {
	// A completed delete invalidates and refetches the unbounded list query
	// (`invalidateAfterDelete` in `useEscalatedDelete.ts`), which can still be
	// in flight through `forceMoreMatchesThanLoaded`'s route handler when a test
	// ends and Playwright closes the page — an unrelated background refetch,
	// not something under test. Cancel any route still pending rather than let
	// it surface as a spurious failure on an otherwise-passed test.
	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	// Global setup seeds a classification fixture whose sender display name is
	// literally "npm" (`e2e/src/classification-fixtures.ts`, the "reported npm
	// shape" case), which a bare "npm" search would also match. `npmbulk` reads
	// the same as the issue's driving "search npm" case without colliding with
	// that fixture. The partial-failure batch is tagged with a disjoint word
	// (`retrybatch`, no shared substring with `npmbulk` in either direction) so
	// a "npmbulk" search — and the real delete it drives in the test before —
	// never touches it; `RUN_TAG` is the one substring common to every fixture
	// below, used only for seeding/cleanup bookkeeping.
	const RUN_TAG = `run${Date.now()}`;
	const NPM_MAIN_COUNT = 105;
	const NPM_LATE_COUNT = 5;
	const NPM_PARTIAL_COUNT = 6;
	const mainSubject = (i: number) => `npmbulk publish notice ${RUN_TAG} #${i}`;
	const partialSubject = (i: number) =>
		`retrybatch partial notice ${RUN_TAG} #${i}`;

	// Real fixtures, seeded once for the whole describe block. `run`/`api` are
	// test-scoped fixtures (one per test) and Playwright doesn't hand those to
	// `beforeAll`/`afterAll`, so these two read the same run state global setup
	// wrote and build their own client directly — same pattern as every other
	// spec's `beforeEach`, just running once for the file. A run owns
	// everything it touches, so `afterAll` cleans up regardless of which tests
	// below actually delete anything.
	test.beforeAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		const main = Array.from({ length: NPM_MAIN_COUNT }, (_, i) => ({
			subject: mainSubject(i + 1),
		}));
		const partial = Array.from({ length: NPM_PARTIAL_COUNT }, (_, i) => ({
			subject: partialSubject(i + 1),
		}));
		await appendMessages(run.imapUser, [...main, ...partial]);
		await api.triggerSync(run.accountId);

		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, RUN_TAG),
			(ids) => ids.length === NPM_MAIN_COUNT + NPM_PARTIAL_COUNT,
			{ timeoutMs: 90_000, what: "the npmbulk fixtures to finish syncing" },
		);
	});

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run.token);
		const leftover = await api.searchMatchingMessageIds(run.inboxId, RUN_TAG);
		for (let i = 0; i < leftover.length; i += 100) {
			await api.deleteMessages(leftover.slice(i, i + 100));
		}
		if (leftover.length > 0) {
			await waitFor(
				() => api.searchMatchingMessageIds(run.inboxId, RUN_TAG),
				(ids) => ids.length === 0,
				{
					timeoutMs: 60_000,
					what: "leftover npmbulk fixtures to finish deleting",
				},
			);
		}
	});

	test("the escalation control appears once every loaded row is selected, and escalating switches the selection to the full matching set", async ({
		page,
		run,
		api,
	}) => {
		await forceMoreMatchesThanLoaded(page, "npmbulk");
		await gotoSearch(page, run.inboxId, "npmbulk");
		await expectSearchResultsCount(page, "npmbulk", NPM_MAIN_COUNT);

		await longPress(page, rows(page).first());
		await selectAllCheckbox(page).click();
		await expect(selectionStatus(page)).toHaveText(
			`All ${NPM_MAIN_COUNT} loaded selected`,
		);

		const escalate = selectionNotice(page).getByRole("button", {
			name: 'Select all matching "npmbulk"',
		});
		await expect(escalate).toBeVisible();
		await escalate.click();

		// The total is real: escalate() pages the match set itself at limit=100,
		// a request this test never mocks.
		await expect(selectionStatus(page)).toHaveText(
			`All ${NPM_MAIN_COUNT} matching "npmbulk" selected`,
			{ timeout: 15_000 },
		);

		await deleteButton(page).click();
		await expect(confirmDialog(page)).toHaveAccessibleName(
			`Move ${NPM_MAIN_COUNT} messages to Trash?`,
		);
		await confirmDialog(page).getByRole("button", { name: "Cancel" }).click();

		// Nothing was sent — the real backend still has every fixture.
		const stillThere = await api.searchMatchingMessageIds(
			run.inboxId,
			"npmbulk",
		);
		expect(stillThere).toHaveLength(NPM_MAIN_COUNT);
	});

	test("an escalated delete resolves the predicate fresh, chunks past the 100-id cap, and the real number removed is what gets reported — not the count from when it was confirmed", async ({
		page,
		run,
		api,
	}) => {
		await forceMoreMatchesThanLoaded(page, "npmbulk");
		await gotoSearch(page, run.inboxId, "npmbulk");
		await expectSearchResultsCount(page, "npmbulk", NPM_MAIN_COUNT);

		await longPress(page, rows(page).first());
		await selectAllCheckbox(page).click();
		await selectionNotice(page)
			.getByRole("button", { name: 'Select all matching "npmbulk"' })
			.click();
		await expect(selectionStatus(page)).toHaveText(
			`All ${NPM_MAIN_COUNT} matching "npmbulk" selected`,
			{ timeout: 15_000 },
		);

		// New mail matching the same predicate, after escalating but before
		// confirming — the regression #92's D2 exists to prevent: a materialized
		// id set would never see this, and the escalated count above was already
		// computed before this lands. The confirm dialog is therefore expected to
		// still show the pre-arrival count (baked in at escalate() time); what
		// must NOT be stale is what the run actually deletes and reports.
		const late = Array.from({ length: NPM_LATE_COUNT }, (_, i) => ({
			subject: mainSubject(NPM_MAIN_COUNT + i + 1),
		}));
		await appendMessages(run.imapUser, late);
		await api.triggerSync(run.accountId);
		const realTotalAtExecution = NPM_MAIN_COUNT + NPM_LATE_COUNT;
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, "npmbulk"),
			(ids) => ids.length === realTotalAtExecution,
			{ timeoutMs: 30_000, what: "the late-arriving npmbulk messages to sync" },
		);

		await deleteButton(page).click();
		// The stale, pre-arrival count — documented, not asserted as correct.
		await expect(confirmDialog(page)).toHaveAccessibleName(
			`Move ${NPM_MAIN_COUNT} messages to Trash?`,
		);
		await confirmDialog(page)
			.getByRole("button", { name: "Move to Trash" })
			.click();

		await expect(selectionBar(page)).toBeHidden({ timeout: 30_000 });
		await expect(
			page.getByText(
				`${realTotalAtExecution} moved to Trash. Your mail server is still catching up.`,
			),
		).toBeVisible();

		// The load-bearing assertion: what the real backend now shows as matching
		// "npmbulk" — not the UI's own claim — is zero. Every fixture, including
		// the ones that arrived after escalating, is gone. (The disjoint
		// `retrybatch` fixtures used by the partial-failure test below are
		// untouched — a different scope, deliberately.)
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, "npmbulk"),
			(ids) => ids.length === 0,
			{
				timeoutMs: 60_000,
				what: "every npmbulk-matching message (including the late arrivals) to be deleted",
			},
		);
	});

	test("partial failure surfaces through the notice, and Retry resends only what failed", async ({
		page,
		run,
		api,
	}) => {
		await forceMoreMatchesThanLoaded(page, "retrybatch");
		let firstDeleteCall = true;
		await page.route("**/messages/delete", async (route) => {
			if (!firstDeleteCall) {
				await route.continue();
				return;
			}
			firstDeleteCall = false;
			const body = route.request().postDataJSON() as { messageIds: string[] };
			// The harness boundary the brief calls out for partial failure: fail
			// the last two of whatever the real request actually carried, so the
			// ids Retry has to resend are real ids from a real search, not ones
			// this test invented. The intercepted call never reaches the backend at
			// all, so the "succeeded" half is deleted here, for real, via the same
			// endpoint the app itself calls (`api`) — otherwise the mocked
			// `successCount` would be a claim nothing backs, which is exactly the
			// gap this suite exists to catch, not reproduce.
			const failedIds = body.messageIds.slice(-2);
			const succeededIds = body.messageIds.slice(0, -2);
			await api.deleteMessages(succeededIds);
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					successCount: succeededIds.length,
					failureCount: failedIds.length,
					failedIds,
				}),
			});
		});

		await gotoSearch(page, run.inboxId, "retrybatch");
		await expect(rows(page)).toHaveCount(NPM_PARTIAL_COUNT, {
			timeout: 30_000,
		});

		await longPress(page, rows(page).first());
		await selectAllCheckbox(page).click();
		await selectionNotice(page)
			.getByRole("button", { name: 'Select all matching "retrybatch"' })
			.click();
		await expect(selectionStatus(page)).toHaveText(
			`All ${NPM_PARTIAL_COUNT} matching "retrybatch" selected`,
			{ timeout: 15_000 },
		);

		await deleteButton(page).click();
		await confirmDialog(page)
			.getByRole("button", { name: "Move to Trash" })
			.click();

		await expect(selectionNotice(page)).toContainText(
			"4 moved to Trash. 2 couldn't be deleted.",
			{ timeout: 15_000 },
		);
		// Failed ids stay selected — the count is what's left, not what
		// disappeared.
		await expect(selectionStatus(page)).toHaveText("2 messages selected");

		// The real backend agrees: only 4 of the 6 are actually gone yet.
		const afterFirstAttempt = await api.searchMatchingMessageIds(
			run.inboxId,
			"retrybatch",
		);
		expect(afterFirstAttempt).toHaveLength(2);

		await selectionNotice(page)
			.getByRole("button", { name: "Retry 2" })
			.click();

		await expect(selectionBar(page)).toBeHidden({ timeout: 15_000 });
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, "retrybatch"),
			(ids) => ids.length === 0,
			{ timeoutMs: 30_000, what: "the retried messages to finish deleting" },
		);
	});
});
