/**
 * Desktop advanced selection (issue #212): "Select all N matching '<query>'"
 * over search results. Desktop had none of the escalation machinery — its
 * `SelectionToolbar` carried bounded verbs only. This drives the flow it now
 * gains: search, select every loaded row, take the escalation offer, and run a
 * verb over the whole matching set, verified against the real backend rather
 * than the toolbar's own copy.
 *
 * The default Playwright project is Desktop Chrome (≥1024 wide), so the desktop
 * two-pane layout and its top `SelectionToolbar` render — no viewport override.
 *
 * Search is driven through the literal `threads/search` path (a committed `q=`
 * URL), never the semantic engine: the e2e lane builds no vector index and
 * `/search/semantic` lazily fetches an embedding model at test time, whose
 * transient failure raises the fatal-error overlay (#219). Nothing here depends
 * on that path.
 */
import type { Locator, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { readRunState } from "../src/state.js";

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/** The desktop bulk-action toolbar's status/count line and its escalation
 *  notice — both plain text in `SelectionToolbar`, located by their copy. */
const toolbarText = (page: Page, text: string): Locator => page.getByText(text);

/** `MessageList`'s load-more threshold — it pages when scrolled this close to
 *  its own bottom. */
const LOAD_MORE_TRIGGER_PX = 200;

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
	await page.goto(`/mail/${mailboxId}?q=${encodeURIComponent(query)}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

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
 * real messages that would trigger it honestly (the server's default page size).
 * Only the general unbounded list request is touched — identified by having no
 * `limit` param, the browsing query's shape, never `useEscalatedActions`'s own
 * 100-id-paged counting/run requests. Real items are handed through untouched;
 * only a `continuationToken` is injected when the response lacked one. Returns a
 * release that stops forcing.
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
	await expectSearchResultsCount(page, query, expectedCount);
	return release;
};

/** Under `THREAD_SEARCH`'s default page the whole set loads at once, so
 *  select-all covers it; comfortably clears the desktop load-more trigger. */
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
		const api = new ApiClient(run.token);
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
		const api = new ApiClient(run.token);
		// The move relocates the fixtures out of the inbox, so sweep every mailbox.
		const mailboxes = await api.listMailboxes(run.accountId);
		for (const mailbox of mailboxes) {
			const leftover = await api.searchMatchingMessageIds(
				mailbox.mailboxId,
				RUN_TAG,
			);
			for (let i = 0; i < leftover.length; i += 100) {
				await api.deleteMessages(leftover.slice(i, i + 100));
			}
		}
	});

	test("offers the escalation once every loaded row is selected, then runs a Move over the whole matching set", async ({
		page,
		run,
		api,
	}) => {
		await searchWithMoreMatchesThanLoaded(page, run.inboxId, QUERY, COUNT);

		// Enter selection with a modifier-click (no navigation), then tick the
		// toolbar's select-all-loaded box — the control desktop gains in #212.
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
		// count is real — escalate() pages the match set itself at limit=100.
		await expect(
			toolbarText(page, `All ${COUNT} matching "${QUERY}" selected`),
		).toBeVisible({ timeout: 15_000 });

		// Every verb runs over the predicate (#114). Move it to Archive.
		await page
			.getByRole("button", { name: "Move selected messages", exact: true })
			.click();
		await page.getByRole("option", { name: "Move to Archive" }).click();

		// The run ends and selection exits — the toolbar goes away.
		await expect(
			page.getByRole("button", { name: "Clear selection" }),
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
