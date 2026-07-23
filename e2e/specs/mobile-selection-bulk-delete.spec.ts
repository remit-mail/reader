/**
 * Mobile selection mode and search-scoped bulk delete (issue #92).
 *
 * The driving case the issue names: search "npm", long-press into selection
 * mode, select everything that matches, delete it. The highest-value claim in
 * this file is that the number the UI ever reports as *deleted* — the
 * completion banner, the partial-failure notice — always matches what
 * actually gets removed; every delete here is verified against the real
 * backend (message ids paged over the API, or subjects read straight off
 * IMAP), never against UI text alone. The confirm dialog's pre-delete count is
 * a labeled estimate, not that claim (#109): `countMatches` and the delete
 * itself re-page the same predicate independently, so mail arriving or
 * leaving in between can make the two disagree.
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

/** The peeking mobile selection sheet, identified by its stable data hook
 *  (`selection-sheet.tsx`). It rises at two or more selected. */
const selectionSheet = (page: Page): Locator =>
	page.locator("[data-selection-sheet]");

/** The sheet's drag grabber — tapping it toggles the teaser/expanded snap. */
const grabber = (page: Page): Locator =>
	page.getByRole("slider", { name: /(Expand|Collapse) selection actions/ });

const cancelSelectionButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Cancel selection" });

const deleteButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages to Trash" });

const selectAllCheckbox = (page: Page): Locator =>
	page.getByRole("checkbox", { name: "Select all" });

/**
 * The sheet's count label and its notice banner are both `role="status"`
 * (`selection-sheet.tsx`); the count label (the always-visible teaser) renders
 * first, the notice — when present, in the expanded body — second.
 */
const selectionStatus = (page: Page): Locator =>
	selectionSheet(page).getByRole("status").first();
const selectionNotice = (page: Page): Locator =>
	selectionSheet(page).getByRole("status").nth(1);

/**
 * Tap the grabber to expand the sheet so its in-sheet actions (delete,
 * select-all, cancel, the escalation notice) become reachable — the teaser
 * only shows the count and the swipe hint.
 */
const expandSheet = async (page: Page): Promise<void> => {
	if (
		await cancelSelectionButton(page)
			.isVisible()
			.catch(() => false)
	)
		return;
	await grabber(page).click();
	await expect(cancelSelectionButton(page)).toBeVisible();
};

/**
 * Long-press the first row, then tap a second row's toggle, so the teaser rises
 * — its threshold is two selected (a single selection enters selection mode but
 * raises no sheet, matching the prototype).
 */
const selectTwoFromTop = async (page: Page): Promise<void> => {
	await longPress(page, rows(page).first());
	await rowToggle(rows(page).nth(1)).click();
	await expect(selectionSheet(page)).toBeVisible();
	await expect(selectionStatus(page)).toHaveText("2 messages selected");
};

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
 * (unlike `useEscalatedActions`'s own 100-id-paged counting/delete requests)
 * calls the endpoint. Real items from the real backend are left untouched;
 * only a `continuationToken` is added when the response didn't already carry
 * one.
 *
 * Returns a release: from the next response on, the real `hasMore` is handed
 * through untouched. A test that goes on to shrink the match set has to call
 * it, because forcing `hasMore` past that point states something the shrunken
 * set contradicts.
 *
 * Private to `searchWithMoreMatchesThanLoaded`, which pairs it with the
 * fixture-size precondition it cannot be used safely without.
 */
const forceMoreMatchesThanLoaded = async (
	page: Page,
	query: string,
): Promise<() => void> => {
	let forcing = true;
	await page.route("**/threads/search?*", async (route) => {
		const url = new URL(route.request().url());
		if (
			!forcing ||
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
	return () => {
		forcing = false;
	};
};

/** `MessageList`'s load-more threshold — it pages when scrolled this close to
 * its own bottom. */
const LOAD_MORE_TRIGGER_PX = 200;

/** The virtualizer's scroll container: the one listbox holding message rows. */
const messageListScroller = (page: Page): Locator =>
	page
		.locator('[role="listbox"]')
		.filter({ has: page.locator("[data-message-row]") });

/**
 * The precondition `forceMoreMatchesThanLoaded` cannot enforce for itself, and
 * the reason every query used with it has to be seeded past a screenful.
 *
 * The injected token is not a real cursor — the server decodes it to `null` and
 * answers the follow-up page with the first page again. That stays harmless
 * only while nothing asks for a follow-up, and `MessageList` asks as soon as
 * the list is scrolled within `LOAD_MORE_TRIGGER_PX` of its own bottom, which a
 * list shorter than its viewport always is. Below that size the same rows are
 * appended on a loop until the list finally outgrows the trigger, and the spec
 * fails somewhere downstream on a result count that looks arbitrary.
 *
 * Measured from `expectedCount` rather than the rows currently in the list,
 * because the failure being guarded against is itself what inflates a live row
 * count — a list already duplicating pages would measure as comfortably tall.
 * Row height is read off the DOM, so a density or layout change moves the
 * threshold with it.
 */
const expectListOutgrowsLoadMoreTrigger = async (
	page: Page,
	query: string,
	expectedCount: number,
): Promise<void> => {
	const firstRow = rows(page).first();
	await expect(firstRow).toBeVisible({ timeout: 30_000 });
	const rowBox = await firstRow.boundingBox();
	if (!rowBox || rowBox.height === 0) {
		throw new Error("message row has no measurable height");
	}
	const viewportHeight = await messageListScroller(page).evaluate(
		(el) => el.clientHeight,
	);
	const listHeight = rowBox.height * expectedCount;
	const needed = viewportHeight + LOAD_MORE_TRIGGER_PX;
	const rowsNeeded = Math.floor(needed / rowBox.height) + 1;
	expect(
		listHeight,
		`The fixture for "${query}" is too small, so the list sits inside MessageList's ${LOAD_MORE_TRIGGER_PX}px load-more trigger: ` +
			`${expectedCount} rows of ${rowBox.height}px come to ${listHeight}px, against a ${viewportHeight}px list viewport that needs ${needed}px cleared. ` +
			"With hasMore forced, the list pages the phantom continuationToken forever and the server answers each pass with the first page again, " +
			"so rows duplicate until the list outgrows the trigger and a later assertion fails on a count that looks arbitrary. " +
			`Seed at least ${rowsNeeded} matching messages, or stop forcing hasMore for this query.`,
	).toBeGreaterThan(needed);
};

/**
 * Runs a search whose result set claims more matches exist beyond the loaded
 * rows, which is the only state the escalation affordance appears in. Owns both
 * halves of that: the forced `hasMore`, and the fixture size that makes forcing
 * it safe. Returns `forceMoreMatchesThanLoaded`'s release.
 */
const searchWithMoreMatchesThanLoaded = async (
	page: Page,
	mailboxId: string,
	query: string,
	expectedCount: number,
): Promise<() => void> => {
	const release = await forceMoreMatchesThanLoaded(page, query);
	try {
		await gotoSearch(page, mailboxId, query);
		await expectListOutgrowsLoadMoreTrigger(page, query, expectedCount);
	} catch (error) {
		// A list already inside the trigger keeps paging the phantom token for as
		// long as it is forced, which buries the assertion above under a test
		// timeout. Stop forcing so the failure reads as itself.
		release();
		throw error;
	}
	await expectSearchResultsCount(page, query, expectedCount);
	return release;
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

		// One selected: selection mode is entered, but the sheet stays down until
		// two are selected (its threshold, matching the prototype).
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
		await expect(selectionSheet(page)).toBeHidden();
	});

	test("a short tap still opens the message outside selection mode", async ({
		page,
	}) => {
		await rows(page).first().click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(selectionSheet(page)).toBeHidden();
	});

	test("avatar tap enters selection mode — long-press is not the only way in", async ({
		page,
	}) => {
		await entryToggle(rows(page).first()).click();

		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
	});

	test("in selection mode, tapping a row's toggle affordance selects and deselects it", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());

		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionSheet(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");

		// Back to one selected: the sheet drops but selection mode stays.
		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionSheet(page)).toBeHidden();
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
	});

	test("in selection mode, a plain tap on the row body toggles it instead of opening the message", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());

		// A tap on the row itself (not the dedicated toggle button) must behave
		// the same as tapping the toggle: select the row, never navigate.
		await rows(page).nth(1).click();
		await expect(selectionSheet(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(page).not.toHaveURL(/selectedMessageId=/);
		await expect(rowToggle(rows(page).nth(1))).toHaveAccessibleName(
			"Deselect message",
		);

		await rows(page).nth(1).click();
		await expect(selectionSheet(page)).toBeHidden();
		await expect(page).not.toHaveURL(/selectedMessageId=/);
	});

	test("swipe actions are suppressed while selection mode is active", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);

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

		// Scoped to the row: the sheet carries its own "Mark as read" verb for the
		// whole selection, which is not a swipe action.
		await expect(
			row.getByRole("button", { name: "Delete message" }),
		).toBeHidden();
		await expect(
			row.getByRole("button", { name: /Mark as (un)?read/ }),
		).toBeHidden();
		// The drag didn't fall through to a toggle either — selection mode
		// renders no swipe gesture surface at all (it's a different component,
		// MessageListItem, not SwipeableRow — see the file header) — so the first
		// row is still the only one selected.
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
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
		await selectTwoFromTop(page);
		await expandSheet(page);
		await selectAllCheckbox(page).click();

		await expect(selectionStatus(page)).toHaveText(
			`All ${run.seededSubjects.length} loaded selected`,
		);
	});

	test("the X clears the selection", async ({ page }) => {
		await selectTwoFromTop(page);
		await expandSheet(page);

		await cancelSelectionButton(page).click();

		await expect(selectionSheet(page)).toBeHidden();
	});

	test("deselecting the last row exits selection mode automatically", async ({
		page,
	}) => {
		await longPress(page, rows(page).first());
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);

		await rowToggle(rows(page).first()).click();

		// Back to the idle affordance — selection mode exited.
		await expect(entryToggle(rows(page).first())).toBeVisible();
		await expect(selectionSheet(page)).toBeHidden();
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
		await selectTwoFromTop(page);
		await expandSheet(page);

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

	test("completing a delete keeps the list, opens no message, and confirms it happened (#202)", async ({
		page,
		run,
		api,
	}) => {
		// Scratch messages, not the globally seeded ones: the suite runs serially
		// over one shared mailbox and other specs assert the inbox holds exactly
		// `seededSubjects` — this appends two (the sheet's threshold), deletes them
		// through the sheet, and the count below proves the baseline is restored.
		const stamp = Date.now();
		const subjects = [
			`Selection-mode exit scratch ${stamp} A`,
			`Selection-mode exit scratch ${stamp} B`,
		];
		await appendMessages(
			run.imapUser,
			subjects.map((subject) => ({ subject })),
		);
		await api.triggerSync(run.accountId);

		const withExtra = run.seededSubjects.length + subjects.length;
		await expect(async () => {
			await page.reload();
			await expect(rows(page)).toHaveCount(withExtra, { timeout: 5_000 });
		}).toPass({ timeout: 60_000 });

		await longPress(
			page,
			page.locator("[data-message-row]").filter({ hasText: subjects[0] }),
		);
		await rowToggle(
			page.locator("[data-message-row]").filter({ hasText: subjects[1] }),
		).click();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expandSheet(page);

		await deleteButton(page).click();
		await confirmDialog(page)
			.getByRole("button", { name: "Move to Trash" })
			.click();

		await expect(selectionSheet(page)).toBeHidden();

		// Single-pane mobile stays on the list — the delete must not navigate into
		// the surviving neighbour's conversation (#202), so there is no reading
		// view to come back from and the rows are still on screen.
		await expect(
			page.getByRole("button", { name: "Back to messages" }),
		).toBeHidden();
		await expect(page).not.toHaveURL(/selectedMessageId=/);
		// The completion banner is the signal the delete landed, since the list
		// gives no navigation cue that anything changed.
		await expect(
			page.getByText(
				"2 moved to Trash. Your mail server is still catching up.",
			),
		).toBeVisible();
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
		for (const subject of subjects) {
			await expect(page.getByText(subject, { exact: true })).toBeHidden();
		}
	});
});

test.describe("Search-scoped escalation and bulk delete", () => {
	// A completed delete invalidates and refetches the unbounded list query
	// (`invalidateAfterRun` in `useEscalatedActions.ts`), which can still be
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
	// that fixture. `RUN_TAG` is the one substring common to every fixture below,
	// used only for seeding/cleanup bookkeeping.
	const RUN_TAG = `run${Date.now()}`;
	// Big enough that the search results fill more than one screen, which
	// `searchWithMoreMatchesThanLoaded` requires and checks: its forced
	// `continuationToken` makes the list believe another page exists, and a
	// result set that fits on screen sits permanently inside `MessageList`'s
	// 200px load-more trigger and pages that phantom token forever, appending
	// the first page again on every pass. At 72px a row (`COMFORTABLE_ITEM_HEIGHT`)
	// this clears an 844px viewport several times over, and it stays clear even at
	// compact density's 32px.
	const NPM_MAIN_COUNT = 105;
	const NPM_LATE_COUNT = 5;
	const mainSubject = (i: number) => `npmbulk publish notice ${RUN_TAG} #${i}`;

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
		await appendMessages(run.imapUser, main);
		await api.triggerSync(run.accountId);

		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, RUN_TAG),
			(ids) => ids.length === NPM_MAIN_COUNT,
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
		await searchWithMoreMatchesThanLoaded(
			page,
			run.inboxId,
			"npmbulk",
			NPM_MAIN_COUNT,
		);

		await selectTwoFromTop(page);
		await expandSheet(page);
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
		// "about": an escalated-predicate count, not a materialized selection
		// (#109) — countMatches and the delete itself re-page the same
		// predicate independently, so the dialog never claims an exact number.
		await expect(confirmDialog(page)).toHaveAccessibleName(
			`Move about ${NPM_MAIN_COUNT} messages to Trash?`,
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
		await searchWithMoreMatchesThanLoaded(
			page,
			run.inboxId,
			"npmbulk",
			NPM_MAIN_COUNT,
		);

		await selectTwoFromTop(page);
		await expandSheet(page);
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
		// The pre-arrival count, honestly labeled as an estimate rather than
		// asserted as the number that gets deleted (#109): "about" says up front
		// that countMatches and the delete re-page the same predicate
		// independently, so this can't be a promise. What must NOT be stale is
		// the completion banner below, which reports the real delivered total.
		await expect(confirmDialog(page)).toHaveAccessibleName(
			`Move about ${NPM_MAIN_COUNT} messages to Trash?`,
		);
		await confirmDialog(page)
			.getByRole("button", { name: "Move to Trash" })
			.click();

		await expect(selectionSheet(page)).toBeHidden({ timeout: 30_000 });
		// The honest number: the actual count the run deleted, including the
		// late arrivals the pre-confirm estimate above never saw — never the
		// stale estimate itself.
		await expect(
			page.getByText(
				`${realTotalAtExecution} moved to Trash. Your mail server is still catching up.`,
			),
		).toBeVisible();

		// The load-bearing assertion: what the real backend now shows as matching
		// "npmbulk" — not the UI's own claim — is zero. Every fixture, including
		// the ones that arrived after escalating, is gone.
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, "npmbulk"),
			(ids) => ids.length === 0,
			{
				timeoutMs: 60_000,
				what: "every npmbulk-matching message (including the late arrivals) to be deleted",
			},
		);
	});
});
