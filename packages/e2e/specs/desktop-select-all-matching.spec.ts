/**
 * Desktop advanced selection (issue #212): "Select all N matching '<query>'"
 * over search results. Desktop had none of the escalation machinery — its bar
 * carried bounded verbs only. This drives the flow it now gains: search, select
 * every loaded row, take the escalation offer, and run a verb over the whole
 * matching set, verified against the real backend rather than the bar's own
 * copy.
 *
 * Since #508 that verb walks the selection wizard, so the claim held against
 * the backend is made twice: nothing has moved while the review screen is
 * naming the predicate and its server count, and everything has once the run
 * screen says so.
 *
 * The default Playwright project is Desktop Chrome (≥1024 wide), so the desktop
 * two-pane layout renders — no viewport override.
 *
 * Search is driven through the literal `threads/search` path (a committed `q=`
 * URL), never the semantic engine: the e2e lane builds no vector index and runs
 * the deterministic in-process embedder rather than the HuggingFace model
 * (#219), so `/search/semantic` returns empty here. Nothing here depends on that
 * path.
 */
import type { Locator, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, waitForServerMailbox } from "../src/imap.js";
import { readRunState } from "../src/state.js";
import { deleteSettledMatchesEverywhere } from "../src/sweep.js";
import {
	advanceTo,
	commitButton,
	dismissRun,
	pickFolder,
	wizardStep,
} from "../src/wizard.js";

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/** The selection bar's count line and its escalation notice, located by copy. */
const toolbarText = (page: Page, text: string): Locator => page.getByText(text);

/** `MessageList`'s load-more threshold — it pages when scrolled this close to
 *  its own bottom. */
const LOAD_MORE_TRIGGER_PX = 200;

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

/** The virtualizer's scroll container: the one listbox holding message rows. */
const messageListScroller = (page: Page): Locator =>
	page
		.locator('[role="listbox"]')
		.filter({ has: page.locator("[data-message-row]") });

/**
 * A committed search: navigating straight to `?q=` renders the filtered,
 * selectable `MessageList` (the live search box's own suggestion dropdown is a
 * typing affordance, not a selectable surface — the desktop equivalent of the
 * phone takeover).
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
 * Forces `hasMore` true for one mailbox search term without seeding more
 * matches than a page holds. Only the list's own browsing request is touched;
 * `useEscalatedActions`'s count and run requests are handed straight through,
 * identified by what they ask for — a count with no rows, or the run's own page
 * size. Real items are handed through untouched; only a `continuationToken` is
 * injected when the response lacked one. Returns a release that stops forcing.
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

/**
 * The injected token is not a real cursor, so the list must be tall enough to
 * clear `MessageList`'s load-more trigger — otherwise it pages the phantom token
 * forever, appending the first page again on every pass. Measured from the
 * expected count, since a list already duplicating pages would measure tall.
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
	expect(
		listHeight,
		`The fixture for "${query}" is too small: ${expectedCount} rows of ${rowBox.height}px come to ${listHeight}px, ` +
			`against a ${viewportHeight}px list viewport that needs ${needed}px cleared. Seed more matching messages.`,
	).toBeGreaterThan(needed);
};

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
		release();
		throw error;
	}
	return release;
};

/** Under the list's own page size the whole set loads at once, so select-all
 *  covers it and `hasMore` has to be forced; comfortably clears the desktop
 *  load-more trigger. */
const COUNT = 40;
const QUERY = "npmdesk";
const RUN_TAG = `run${Date.now()}dk`;
const subjectFor = (i: number) => `${QUERY} release notice ${RUN_TAG} #${i}`;

test.describe("Desktop select-all-matching over search results", () => {
	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	// `run`/`api` are per-test fixtures Playwright does not hand to
	// `beforeAll`/`afterAll`, so these read the run state global setup wrote and
	// build their own client — the same pattern the mobile escalation spec uses.
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
			{ timeoutMs: 90_000, what: "the npmdesk fixtures to finish syncing" },
		);
	});

	test.afterAll(async () => {
		const run = readRunState();
		const api = new ApiClient(run);
		// The move relocates the fixtures out of the inbox, so sweep every mailbox
		// — and wait out the move first: the rows read as filed in Archive while
		// the IMAP copy is still in flight, and the delete is refused against one
		// of those (#1155).
		await deleteSettledMatchesEverywhere(api, run.accountId, RUN_TAG);
		// Dovecot decides what the next sync puts back, so the sweep is not done
		// until the server's inbox is clear of these fixtures — the read model
		// drops them the moment the delete is accepted, the IMAP write follows.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => !subjects.some((subject) => subject.includes(RUN_TAG)),
			{ what: `the ${RUN_TAG} fixtures to leave the inbox` },
		);
	});

	test("offers the escalation once every loaded row is selected, then reviews and runs a Move over the whole matching set", async ({
		page,
		run,
		api,
	}) => {
		await searchWithMoreMatchesThanLoaded(page, run.inboxId, QUERY, COUNT);

		// Enter selection with a modifier-click (no navigation), then tick the
		// bar's select-all-loaded control — inline from 768px up.
		await rows(page)
			.first()
			.click({ modifiers: ["ControlOrMeta"] });
		await page.getByRole("checkbox", { name: "Select all" }).click();
		await expect(
			toolbarText(page, `All ${COUNT} loaded selected`),
		).toBeVisible();

		// The offer names the scope — never a bare "Select all".
		const offer = page.getByRole("button", {
			name: `Select all matching "${QUERY}"`,
		});
		await expect(offer).toBeVisible();
		await offer.click();

		// Past counting: the selection is now the predicate, its total named. The
		// count is real — escalate() asks the server how many match, unmocked.
		await expect(
			toolbarText(page, `All ${COUNT} matching "${QUERY}" selected`),
		).toBeVisible({ timeout: 15_000 });

		// Every verb runs over the predicate (#114), and every one of them opens
		// the wizard (#508). Move it to Archive.
		await page
			.getByRole("button", { name: "Move selected messages", exact: true })
			.click();
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 4 · Apply to$/, {
			timeout: 20_000,
		});
		// The match step names what the predicate covers; there is nothing to
		// widen, so it offers no doors.
		await expect(
			page.getByText(`Every message matching "${QUERY}"`),
		).toBeVisible();

		await advanceTo(page, "Folder");
		await pickFolder(page, "Archive");
		await advanceTo(page, "Review");

		// The review names the server's count before any mail is touched.
		await expect(
			page.getByText(
				`Move all ${COUNT} messages matching "${QUERY}" to Archive`,
			),
		).toBeVisible();
		const untouched = await api.searchMatchingMessageIds(run.inboxId, QUERY);
		expect(untouched).toHaveLength(COUNT);

		await commitButton(page, "Move").click();
		await expect(page.getByText(`Moved ${COUNT}`)).toBeVisible({
			timeout: 30_000,
		});
		await dismissRun(page);

		// The run ends and selection exits — the toolbar goes away.
		await expect(
			page.getByRole("button", { name: "Cancel selection" }),
		).toBeHidden({ timeout: 30_000 });

		// The load-bearing check: the real backend. The inbox no longer matches,
		// and Archive holds every one — the move paged the whole predicate.
		await waitFor(
			() => api.searchMatchingMessageIds(run.inboxId, QUERY),
			(ids) => ids.length === 0,
			{ timeoutMs: 60_000, what: "every npmdesk match to leave the inbox" },
		);
		const mailboxes = await api.listMailboxes(run.accountId);
		const archive = mailboxes.find((m) => m.fullPath === "Archive");
		if (!archive)
			throw new Error("the account has no Archive mailbox to move to");
		await waitFor(
			() => api.searchMatchingMessageIds(archive.mailboxId, QUERY),
			(ids) => ids.length === COUNT,
			{ timeoutMs: 60_000, what: "every npmdesk match to land in Archive" },
		);
	});
});
