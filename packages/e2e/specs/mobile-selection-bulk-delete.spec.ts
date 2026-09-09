/**
 * Mobile selection mode and search-scoped bulk delete (issue #92).
 *
 * The driving case the issue names: search "npm", long-press into selection
 * mode, select everything that matches, delete it. The highest-value claim in
 * this file is that the number the UI reports as *deleted* on the run screen
 * always matches what actually gets removed; every delete here is verified
 * against the real backend (message ids paged over the API, or subjects read
 * straight off IMAP), never against UI text alone.
 *
 * The review screen's count is a different claim (#109): the predicate is
 * resolved once for the count and again for the run, so mail arriving in
 * between makes the two disagree — which the review says on the screen, and
 * the escalated-delete test below drives on purpose.
 *
 * The one thing this harness cannot reproduce cheaply is worked around
 * deliberately, noted where it is used: the "search has more matches than are
 * loaded" affordance only appears once a mailbox search's first page comes
 * back with a `continuationToken`. Since #306 the list asks for its own page
 * size (`LIST_PAGE_SIZE`), so a fixture larger than one page triggers it
 * honestly and the npmbulk block below does exactly that. For a fixture that
 * fits in one page the trigger is still forced via `page.route`, injecting a
 * `continuationToken` into that one response. Everything downstream —
 * `escalate()`'s own count (a *different* request, asking the server how many
 * match and for no rows) and the run it drives — is completely real against the
 * messages seeded below and is never touched by the mock.
 */
import type { Locator, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, waitForServerMailbox } from "../src/imap.js";
import { readRunState } from "../src/state.js";
import { deleteSettledMatchesEverywhere } from "../src/sweep.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";
import {
	advanceTo,
	commitButton,
	dismissRun,
	pickFolder,
	wizardStep,
} from "../src/wizard.js";

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE });

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/** The page size the mailbox list asks for (`DEFAULT_THREADS_PAGE_SIZE`, sent
 *  explicitly since #306), so a larger match set loads this many rows and
 *  legitimately reports more to come. */
const LIST_PAGE_SIZE = 50;

/** The page size `useEscalatedActions` pages its run requests at, which is what
 *  tells them apart from the list's browsing query. */
const ESCALATION_PAGE_SIZE = "100";

/**
 * The list's own browsing request for one query. Never `useEscalatedActions`'s
 * count or run requests: the count asks for `count=true` and no rows, and the
 * run pages at its own size, which since #306 the browsing query never uses.
 */
const isBrowsingSearchRequest = (url: string, query: string): boolean => {
	const parsed = new URL(url);
	return (
		parsed.pathname.endsWith("/threads/search") &&
		parsed.searchParams.get("query") === query &&
		parsed.searchParams.get("limit") !== ESCALATION_PAGE_SIZE &&
		parsed.searchParams.get("count") !== "true"
	);
};

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

const cancelSelectionButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Cancel selection" });

const deleteButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages to Trash" });

/** The bar's Move verb (the move-to-folder trigger). */
const moveButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages", exact: true });

/** Mark read is an overflow verb, reached through the bar's kebab. */
const markRead = async (page: Page): Promise<void> => {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Mark read" }).click();
};

const selectAllCheckbox = (page: Page): Locator =>
	page.getByRole("checkbox", { name: "Select all" });

/**
 * The bar's count label and its notice banner, each by its own hook: the bar
 * also holds the search field, whose own live region would otherwise answer to
 * `role="status"` first.
 */
const selectionStatus = (page: Page): Locator =>
	page.locator("[data-selection-count]");
const selectionNotice = (page: Page): Locator =>
	page.locator("[data-selection-notice]");

/** Long-press the first row, then tap a second row's toggle. */
const selectTwoFromTop = async (page: Page): Promise<void> => {
	await longPress(page, rows(page).first());
	await rowToggle(rows(page).nth(1)).click();
	await expect(selectionStatus(page)).toBeVisible();
	await expect(selectionStatus(page)).toHaveText("2 messages selected");
};

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
 *
 * That the takeover is closed used to be checked by asserting no "Search mail"
 * textbox was visible. That assertion could only ever pass: it ran between
 * `page.goto` resolving and React mounting, when no textbox existed yet, and the
 * header legitimately carries the committed query in a field once it has
 * rendered. What actually distinguishes the two surfaces is the rows: only the
 * real `MessageList` renders `[data-message-row]`, and only the committed search
 * renders the results header, so both are asserted instead.
 */
const gotoSearch = async (
	page: Page,
	mailboxId: string,
	query: string,
): Promise<void> => {
	// Wait for the query's own page to land. The committed search re-keys the
	// list query and the previous rows stand until it answers, so a select-all
	// taken before then covers the mailbox's rows instead of the query's. The
	// response is the exact signal; the header's count answers a request of its
	// own (#307) and settles on its own schedule.
	const answered = page.waitForResponse(
		(response) =>
			isBrowsingSearchRequest(response.url(), query) && response.ok(),
		{ timeout: 30_000 },
	);
	await page.goto(`/mail/${mailboxId}?q=${encodeURIComponent(query)}`);
	await answered;
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
	// A number, from the server counting the whole match set — never the length
	// of the page on screen (#307).
	await expect(
		page.getByText(new RegExp(`\\d[\\d,.\\s]* results? for “${query}”`)),
	).toBeVisible({ timeout: 30_000 });
};

/**
 * Forces `hasMore` true for one mailbox search term without seeding more matches
 * than a page holds (see file header). Only the list's own browsing request for
 * the given query is touched; `useEscalatedActions`'s count and delete requests
 * are handed straight through, identified by what they ask for — a count with no
 * rows, or the run's own page size. Real items from the real backend are left
 * untouched; only a `continuationToken` is added when the response didn't
 * already carry one.
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
		if (!forcing || !isBrowsingSearchRequest(route.request().url(), query)) {
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
 * it safe. `loadedCount` is how many rows the list ends up holding — the whole
 * match set when it fits in one page, `LIST_PAGE_SIZE` when it does not. Returns
 * `forceMoreMatchesThanLoaded`'s release.
 */
const searchWithMoreMatchesThanLoaded = async (
	page: Page,
	mailboxId: string,
	query: string,
	loadedCount: number,
): Promise<() => void> => {
	const release = await forceMoreMatchesThanLoaded(page, query);
	try {
		await gotoSearch(page, mailboxId, query);
		await expectListOutgrowsLoadMoreTrigger(page, query, loadedCount);
	} catch (error) {
		// A list already inside the trigger keeps paging the phantom token for as
		// long as it is forced, which buries the assertion above under a test
		// timeout. Stop forcing so the failure reads as itself.
		release();
		throw error;
	}
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

		// One selected: selection mode is entered and the bar takes the title's
		// place with the count.
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
		await expect(selectionStatus(page)).toHaveText("1 message selected");
	});

	test("a short tap still opens the message outside selection mode", async ({
		page,
	}) => {
		await rows(page).first().click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(selectionStatus(page)).toBeHidden();
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
		await expect(selectionStatus(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");

		// Back to one selected: the count follows, selection mode stays.
		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionStatus(page)).toHaveText("1 message selected");
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
		await expect(selectionStatus(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
		await expect(rowToggle(rows(page).nth(1))).toHaveAccessibleName(
			"Deselect message",
		);

		await rows(page).nth(1).click();
		await expect(selectionStatus(page)).toHaveText("1 message selected");
		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
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

		// Scoped to the row: the bar carries its own mark-read verb for the whole
		// selection, which is not a swipe action.
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
		await selectAllCheckbox(page).click();

		await expect(selectionStatus(page)).toHaveText(
			`All ${run.seededSubjects.length} loaded selected`,
		);
	});

	test("the back arrow clears the selection", async ({ page }) => {
		await selectTwoFromTop(page);

		await cancelSelectionButton(page).click();

		await expect(selectionStatus(page)).toBeHidden();
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
		await expect(selectionStatus(page)).toBeHidden();
	});
});

test.describe("Confirm dialog", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
			timeout: 30_000,
		});
	});

	test("names what the delete covers, and cancelling it deletes nothing", async ({
		page,
		run,
	}) => {
		await selectTwoFromTop(page);

		await deleteButton(page).click();
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 3 · Apply to$/, {
			timeout: 20_000,
		});
		await advanceTo(page, "Review");
		// A named match is never an unseen bulk action: the review states it as
		// one sentence and closes with the messages themselves.
		await expect(page.getByText(/Delete 2 messages/)).toBeVisible();

		// The wizard's own Cancel, not the selection bar's "Cancel selection"
		// behind it: the wizard is a modal, and this names only its control.
		await page.getByRole("button", { name: "Cancel", exact: true }).click();

		await expect(wizardStep(page)).toHaveCount(0);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length);
	});

	test("completing a delete keeps the list, opens no message, and confirms it happened (#202)", async ({
		page,
		run,
		api,
	}) => {
		// Scratch messages, not the globally seeded ones: the suite runs serially
		// over one shared mailbox and other specs assert the inbox holds exactly
		// `seededSubjects` — this appends two, deletes them through the bar, and
		// the count below proves the baseline is restored.
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

		await deleteButton(page).click();
		await advanceTo(page, "Review");
		await commitButton(page, "Delete").click();
		await expect(page.getByText("Deleted 2")).toBeVisible({ timeout: 30_000 });
		await dismissRun(page);

		await expect(selectionStatus(page)).toBeHidden();

		// Single-pane mobile stays on the list — the delete must not navigate into
		// the surviving neighbour's conversation (#202), so there is no reading
		// view to come back from and the rows are still on screen.
		await expect(
			page.getByRole("button", { name: "Back to messages" }),
		).toBeHidden();
		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
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
	// literally "npm" (`packages/e2e/src/classification-fixtures.ts`, the "reported npm
	// shape" case), which a bare "npm" search would also match. `npmbulk` reads
	// the same as the issue's driving "search npm" case without colliding with
	// that fixture. `RUN_TAG` is the one substring common to every fixture below,
	// used only for seeding/cleanup bookkeeping.
	const RUN_TAG = `run${Date.now()}`;
	// Larger than one list page, so the server's own `continuationToken` puts the
	// list in the "more matches than are loaded" state with nothing mocked: the
	// escalation this block drives really does reach past the rows on screen.
	// It also fills more than one screen several times over at 72px a row
	// (`COMFORTABLE_ITEM_HEIGHT`), which keeps the list clear of `MessageList`'s
	// 200px load-more trigger — a list sitting inside it pages on its own and the
	// loaded count would not hold still.
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
		const api = new ApiClient(run);
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
		const api = new ApiClient(run);
		const leftover = await api.searchMatchingMessageIds(run.inboxId, RUN_TAG);
		for (let i = 0; i < leftover.length; i += 100) {
			await api.deleteMessages(leftover.slice(i, i + 100));
		}
		// Dovecot decides what the next sync puts back, so the sweep is not done
		// until the server's inbox is clear of these fixtures — the read model
		// drops them the moment the delete is accepted, the IMAP write follows.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.some((subject) => subject.includes(RUN_TAG)),
			{ what: "the npmbulk fixtures to leave the inbox" },
		);
	});

	test("the escalation control appears once every loaded row is selected, and escalating switches the selection to the full matching set", async ({
		page,
		run,
		api,
	}) => {
		// The list holds one page; the match set is twice that, which is what makes
		// the escalation offer honest here.
		await searchWithMoreMatchesThanLoaded(
			page,
			run.inboxId,
			"npmbulk",
			LIST_PAGE_SIZE,
		);

		await selectTwoFromTop(page);
		await selectAllCheckbox(page).click();
		await expect(selectionStatus(page)).toHaveText(
			`All ${LIST_PAGE_SIZE} loaded selected`,
		);

		const escalate = selectionNotice(page).getByRole("button", {
			name: 'Select all matching "npmbulk"',
		});
		await expect(escalate).toBeVisible();
		await escalate.click();

		// The total is real: escalate() asks the server how many match, a request
		// this test never mocks.
		await expect(selectionStatus(page)).toHaveText(
			`All ${NPM_MAIN_COUNT} matching "npmbulk" selected`,
			{ timeout: 15_000 },
		);

		// The predicate opens the same wizard a ticked selection does (#508). Its
		// match step names what the predicate covers rather than offering three
		// ways to widen a match that is already the widest it gets.
		await deleteButton(page).click();
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 3 · Apply to$/, {
			timeout: 20_000,
		});
		await expect(
			page.getByText('Every message matching "npmbulk"'),
		).toBeVisible();

		await advanceTo(page, "Review");
		// The count the server gave the predicate, stated before anything runs.
		await expect(
			page.getByText(
				`Delete all ${NPM_MAIN_COUNT} messages matching "npmbulk"`,
			),
		).toBeVisible();

		// The wizard's own Cancel, not the bar's "Cancel selection" behind it.
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(wizardStep(page)).toHaveCount(0);

		// Nothing was sent — the real backend still has every fixture.
		const stillThere = await api.searchMatchingMessageIds(
			run.inboxId,
			"npmbulk",
		);
		expect(stillThere).toHaveLength(NPM_MAIN_COUNT);
	});

	/**
	 * The run screen says "This keeps running if you close the wizard" (#521),
	 * and the whole match is two pages here, so what it promises is only visible
	 * past the first page boundary — where the run reads whether it has been told
	 * to stop.
	 *
	 * The first batch is held at the proxy, which parks the run on that boundary
	 * and makes the walk-away deliberate rather than a race with a fast backend.
	 * Mark read rather than delete or move, so the fixtures this block shares are
	 * still where the tests after it expect them.
	 */
	test("closing the wizard mid-run leaves the run going, and the list reports how it ended", async ({
		page,
		run,
		api,
	}) => {
		await searchWithMoreMatchesThanLoaded(
			page,
			run.inboxId,
			"npmbulk",
			LIST_PAGE_SIZE,
		);

		await selectTwoFromTop(page);
		await selectAllCheckbox(page).click();
		await selectionNotice(page)
			.getByRole("button", { name: 'Select all matching "npmbulk"' })
			.click();
		await expect(selectionStatus(page)).toHaveText(
			`All ${NPM_MAIN_COUNT} matching "npmbulk" selected`,
			{ timeout: 15_000 },
		);

		let releaseFirstBatch: () => void = () => {};
		const firstBatchHeld = new Promise<void>((resolve) => {
			releaseFirstBatch = resolve;
		});
		let batches = 0;
		await page.route("**/messages/flags", async (route) => {
			batches += 1;
			if (batches === 1) await firstBatchHeld;
			await route.continue();
		});

		await markRead(page);
		await advanceTo(page, "Review");
		await commitButton(page, "Mark read").click();
		await expect
			.poll(() => batches, { timeout: 30_000 })
			.toBeGreaterThanOrEqual(1);

		// The walk-away the screen invites. The wizard goes; the run does not.
		await page.getByRole("button", { name: "Close", exact: true }).click();
		await expect(wizardStep(page)).toHaveCount(0);
		await expect(selectionStatus(page)).toHaveText(
			`Marking 0 of ${NPM_MAIN_COUNT} as read…`,
		);

		releaseFirstBatch();

		// The ending, stated to the user who left: the list says what the run
		// covered once there is no run screen left to say it.
		await expect(
			page.getByText(
				`${NPM_MAIN_COUNT} marked as read. Your mail server is still catching up.`,
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(selectionStatus(page)).toBeHidden({ timeout: 30_000 });

		// The load-bearing check: the real backend. The run paged past the batch
		// the user walked away from and reached every match, not just the first.
		await waitFor(
			() => api.searchThreads(run.inboxId),
			(threads) => {
				const mine = threads.filter((t) => t.subject?.includes(RUN_TAG));
				return (
					mine.length === NPM_MAIN_COUNT && mine.every((t) => t.isRead === true)
				);
			},
			{
				timeoutMs: 60_000,
				what: "every npmbulk fixture to be marked read by the run the wizard was closed over",
			},
		);
	});

	test("an escalated delete resolves the predicate fresh, chunks past the 100-id cap, and the real number removed is what gets reported — not the count from when it was confirmed", async ({
		page,
		run,
		api,
	}) => {
		// The list holds one page; the match set is twice that, which is what makes
		// the escalation offer honest here.
		await searchWithMoreMatchesThanLoaded(
			page,
			run.inboxId,
			"npmbulk",
			LIST_PAGE_SIZE,
		);

		await selectTwoFromTop(page);
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
		await advanceTo(page, "Review");
		// The pre-arrival count, stated on the review screen with the warning
		// that the run covers whatever matches by the time it goes (#109): the
		// count and the run resolve the predicate independently, so the number
		// here is a reading, not a promise. What must NOT be stale is the run
		// screen below, which reports the real delivered total.
		await expect(
			page.getByText(
				`Delete all ${NPM_MAIN_COUNT} messages matching "npmbulk"`,
			),
		).toBeVisible();
		await expect(
			page.getByText(/anything else matching by the time it runs/),
		).toBeVisible();
		await commitButton(page, "Delete").click();

		// The honest number: the actual count the run deleted, including the
		// late arrivals the count above never saw — never the stale reading.
		await expect(page.getByText(`Deleted ${realTotalAtExecution}`)).toBeVisible(
			{ timeout: 30_000 },
		);
		await dismissRun(page);
		await expect(selectionStatus(page)).toBeHidden({ timeout: 30_000 });

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

/**
 * Verb parity over an escalated selection (#114, #212): an escalated selection
 * is a predicate, not an id list, and every verb — not just delete — has to run
 * by paging it. These drive mark-read and move over the whole matching set and
 * verify the real backend, the same way the delete tests above do: the mark
 * lands as read on the server, the move lands the messages in the destination.
 */
test.describe("Search-scoped escalated move and mark-read", () => {
	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	const RUN_TAG = `run${Date.now()}vp`;
	// Enough that the results outrun the load-more trigger at comfortable density
	// (the escalation precondition `searchWithMoreMatchesThanLoaded` checks), and
	// under `listThreads`' 50-per-page default so the mark-read verification can
	// read every fixture's read flag back in one page.
	const COUNT = 40;
	const QUERY = "npmverb";
	const subjectFor = (i: number) => `${QUERY} weekly digest ${RUN_TAG} #${i}`;

	test.beforeAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run);
		await appendMessages(
			run.imapUser,
			Array.from({ length: COUNT }, (_, i) => ({ subject: subjectFor(i + 1) })),
		);
		await api.triggerSync(run.accountId);
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, RUN_TAG),
			(ids) => ids.length === COUNT,
			{ timeoutMs: 90_000, what: "the npmverb fixtures to finish syncing" },
		);
	});

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run);
		// The move test relocates the fixtures out of the inbox, so cleanup sweeps
		// every mailbox rather than the inbox alone — a run leaves no scraps. The
		// sweep waits out that move: the rows read as filed in the destination
		// while the IMAP copy is still in flight, and the delete is refused
		// against one of those (#1155).
		await deleteSettledMatchesEverywhere(api, run.accountId, RUN_TAG);
		// Dovecot decides what the next sync puts back, so the sweep is not done
		// until the server's inbox is clear of these fixtures — the read model
		// drops them the moment the delete is accepted, the IMAP write follows.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.some((subject) => subject.includes(RUN_TAG)),
			{ what: "the npmverb fixtures to leave the inbox" },
		);
	});

	const escalate = async (page: Page): Promise<void> => {
		await searchWithMoreMatchesThanLoaded(
			page,
			readRunState().inboxId,
			QUERY,
			COUNT,
		);
		await selectTwoFromTop(page);
		await selectAllCheckbox(page).click();
		await selectionNotice(page)
			.getByRole("button", { name: `Select all matching "${QUERY}"` })
			.click();
		await expect(selectionStatus(page)).toHaveText(
			`All ${COUNT} matching "${QUERY}" selected`,
			{ timeout: 15_000 },
		);
	};

	test("mark-read pages the predicate and lands every match read on the server", async ({
		page,
		run,
		api,
	}) => {
		await escalate(page);

		await markRead(page);
		await advanceTo(page, "Review");
		await expect(
			page.getByText(`Mark read all ${COUNT} messages matching "${QUERY}"`),
		).toBeVisible();
		await commitButton(page, "Mark read").click();

		await expect(page.getByText(`Marked read ${COUNT}`)).toBeVisible({
			timeout: 30_000,
		});
		await dismissRun(page);
		await expect(selectionStatus(page)).toBeHidden({ timeout: 30_000 });

		// The load-bearing check: the real backend, not the UI's own claim. Every
		// fixture thread now reads as read.
		await waitFor(
			() => api.listThreads(run.inboxId),
			(threads) => {
				const mine = threads.filter((t) => t.subject?.includes(RUN_TAG));
				return mine.length === COUNT && mine.every((t) => t.isRead === true);
			},
			{ timeoutMs: 60_000, what: "every npmverb fixture to be marked read" },
		);
	});

	test("the keyboard reaches no verb over the predicate that the bar would have reviewed", async ({
		page,
		run,
		api,
	}) => {
		await escalate(page);

		// The hole this closes: a shortcut aimed at a selection ran the verb
		// outright, so "select all 3,412 matching" plus one keystroke filed the lot
		// with nothing named and nothing to cancel. Both keys now land on the same
		// review screen the bar's verbs land on.
		await page.keyboard.press("!");
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 3 · Apply to$/, {
			timeout: 20_000,
		});
		await expect(
			page.getByText(`Every message matching "${QUERY}"`),
		).toBeVisible();
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(wizardStep(page)).toHaveCount(0);

		await page.keyboard.press("u");
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 3 · Apply to$/, {
			timeout: 20_000,
		});
		await advanceTo(page, "Review");
		await expect(
			page.getByText(`Mark read all ${COUNT} messages matching "${QUERY}"`),
		).toBeVisible();

		// Nothing left for the mail server while both screens were up: the whole
		// fixture set is still where it was, unread and in the inbox.
		const untouched = await api.searchMatchingMessageIds(run.inboxId, QUERY);
		expect(untouched).toHaveLength(COUNT);

		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(wizardStep(page)).toHaveCount(0);
	});

	test("move pages the predicate and files every match in the destination", async ({
		page,
		run,
		api,
	}) => {
		await escalate(page);

		await moveButton(page).click();
		await advanceTo(page, "Folder");
		// Archive is a standard destination in the picker on this account.
		await pickFolder(page, "Archive");
		await advanceTo(page, "Review");
		await expect(
			page.getByText(
				`Move all ${COUNT} messages matching "${QUERY}" to Archive`,
			),
		).toBeVisible();
		await commitButton(page, "Move").click();

		await expect(page.getByText(`Moved ${COUNT}`)).toBeVisible({
			timeout: 30_000,
		});
		await dismissRun(page);
		await expect(selectionStatus(page)).toBeHidden({ timeout: 30_000 });

		// The move left the inbox empty of the fixtures and filled Archive with
		// them — checked against the backend, paged independently of the UI.
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, QUERY),
			(ids) => ids.length === 0,
			{ timeoutMs: 60_000, what: "every npmverb fixture to leave the inbox" },
		);
		const mailboxes = await api.listMailboxes(run.accountId);
		const archive = mailboxes.find((m) => m.fullPath === "Archive");
		if (!archive)
			throw new Error("the account has no Archive mailbox to move to");
		await waitFor(
			() => api.searchMatchingMessageIds(archive.mailboxId, QUERY),
			(ids) => ids.length === COUNT,
			{ timeoutMs: 60_000, what: "every npmverb fixture to land in Archive" },
		);
	});
});
