/**
 * Guided mobile organize flow (issue #211).
 *
 * From the mobile selection sheet, "Select similar messages" widens the
 * selection with the read-only matcher, shows a brief widening state, then
 * opens the organize sentence inside a bottom sheet on that widened set; the
 * sentence commits at one of four scopes. This spec drives that surface end to
 * end on a mobile viewport.
 *
 * The widen is a semantic query, and the vector index is deliberately not built
 * on the e2e lane (see issue #219 and organize-standing-filter.spec.ts). So the
 * `POST /organize/preview` response is stubbed per scenario to control the
 * matched set — the semantic matcher itself is covered by the colocated
 * mobile-organize-flow unit tests. Downstream of the sentence, the "Just these"
 * move runs for real (it files the selection with the ordinary move endpoint);
 * the organize job and the standing filter, both of which re-run the same
 * absent index server-side, are stubbed so the flow's progress and success
 * states are exercised deterministically. Real filter CRUD is covered by
 * organize-standing-filter.spec.ts.
 *
 * Each test appends its own tagged scratch and cleans it up, so the serial
 * suite's exact inbox-count invariant is restored on the way out.
 */
import type { Locator, Page } from "@playwright/test";
import type { ApiClient } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE });

interface RunScratchState {
	imapUser: string;
	accountId: string;
	inboxId: string;
	seededSubjects: string[];
}

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/** A long press with real pointer events — the input the row's 500ms timer listens for. */
const longPress = async (page: Page, row: Locator): Promise<void> => {
	const box = await row.boundingBox();
	if (!box) throw new Error("row has no bounding box to long-press");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(650);
	await page.mouse.up();
};

const rowToggle = (row: Locator): Locator =>
	row.getByRole("button", { name: /^(Select|Deselect) message$/ });

const selectionSheet = (page: Page): Locator =>
	page.locator("[data-selection-sheet]");

const grabber = (page: Page): Locator =>
	page.getByRole("slider", { name: /(Expand|Collapse) selection actions/ });

const selectSimilarButton = (page: Page): Locator =>
	page.getByRole("button", { name: /Select similar messages/ });

const somethingElseButton = (page: Page): Locator =>
	page.getByRole("button", { name: /Something else/ });

const destinationSelect = (page: Page): Locator =>
	page.getByLabel("Destination folder");

const gotoInbox = async (page: Page, mailboxId: string): Promise<void> => {
	await page.goto(`/mail/${mailboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

/** Expand the peeking sheet until the smart-flow rows are reachable. */
const expandSheet = async (page: Page): Promise<void> => {
	if (
		await selectSimilarButton(page)
			.isVisible()
			.catch(() => false)
	)
		return;
	await grabber(page).click();
	await expect(selectSimilarButton(page)).toBeVisible();
};

/** Select the two given rows so the teaser rises, then expand it. */
const selectTwoAndExpand = async (
	page: Page,
	a: Locator,
	b: Locator,
): Promise<void> => {
	await longPress(page, a);
	await rowToggle(b).click();
	await expect(selectionSheet(page)).toBeVisible();
	await expandSheet(page);
};

/**
 * Append tagged scratch to the inbox and wait for it to appear, returning a
 * `cleanup` that deletes it by id wherever it ends up — so the shared inbox's
 * baseline count is restored regardless of what the scope under test did.
 */
const seedScratch = async (
	page: Page,
	run: RunScratchState,
	api: ApiClient,
	tag: string,
): Promise<{
	first: Locator;
	second: Locator;
	cleanup: () => Promise<void>;
}> => {
	const subjects = [`${tag} A`, `${tag} B`];
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

	const first = rows(page).filter({ hasText: subjects[0] });
	const second = rows(page).filter({ hasText: subjects[1] });

	const cleanup = async () => {
		for (const mailbox of await api.listMailboxes(run.accountId)) {
			const ids = await api.searchMatchingMessageIds(mailbox.mailboxId, tag);
			if (ids.length > 0) await api.deleteMessages(ids);
		}
	};

	return { first, second, cleanup };
};

/**
 * Stub the widen so the matched set is deterministic without a vector index.
 * The small delay keeps the brief widening state observable before the sentence.
 */
const stubPreview = async (
	page: Page,
	body: { matchedCount: number; messageIds: string[] },
): Promise<void> => {
	await page.route(/\/organize\/preview$/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 400));
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(body),
		});
	});
};

test.describe("Guided mobile organize flow", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
	});

	test("Select similar widens, then runs the organize job to a done summary", async ({
		page,
		run,
		api,
	}) => {
		const { first, second, cleanup } = await seedScratch(
			page,
			run,
			api,
			`organize-job ${Date.now()}`,
		);

		await stubPreview(page, {
			matchedCount: 2,
			messageIds: ["stub-1", "stub-2"],
		});
		// The async back-apply needs the same absent index, so the job is stubbed:
		// create returns a running job, the poll returns a completed one.
		await page.route(/\/organize$/, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					organizeJobId: "job-1",
					state: "Running",
					matchedCount: 2,
					appliedCount: 0,
					failedCount: 0,
				}),
			}),
		);
		await page.route(/\/organize\/job-1$/, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					organizeJobId: "job-1",
					state: "Complete",
					matchedCount: 2,
					appliedCount: 2,
					failedCount: 0,
				}),
			}),
		);

		try {
			await selectTwoAndExpand(page, first, second);
			await selectSimilarButton(page).click();

			await expect(page.getByText("Finding similar messages…")).toBeVisible();
			await expect(page.getByText(/2 similar messages found/)).toBeVisible();

			await destinationSelect(page).selectOption({ label: "Archive" });
			// "All like these" is the default scope.
			await page.getByRole("button", { name: /Organize 2 messages/ }).click();

			await expect(page.getByText(/2 of 2 moved/)).toBeVisible({
				timeout: 15_000,
			});
			await page.getByRole("button", { name: "Done" }).click();
			await expect(selectionSheet(page)).toBeHidden();
		} finally {
			await cleanup();
		}
	});

	test("Select similar commits a standing filter", async ({
		page,
		run,
		api,
	}) => {
		const tag = `organize-filter ${Date.now()}`;
		const { first, second, cleanup } = await seedScratch(page, run, api, tag);

		await stubPreview(page, {
			matchedCount: 3,
			messageIds: ["stub-1", "stub-2", "stub-3"],
		});
		// Real filter CRUD is covered elsewhere; here the standing-scope commit
		// wiring is exercised against a stubbed create so it stays deterministic.
		await page.route(/\/filters$/, (route) =>
			route.fulfill({
				status: 201,
				contentType: "application/json",
				body: JSON.stringify({
					filterId: "filter-1",
					name: tag,
					scope: "Standing",
				}),
			}),
		);

		try {
			await selectTwoAndExpand(page, first, second);
			await selectSimilarButton(page).click();

			await expect(page.getByText(/3 similar messages found/)).toBeVisible();

			await destinationSelect(page).selectOption({ label: "Archive" });
			await page
				.getByRole("button", { name: "These and new mail like this" })
				.click();
			await page.getByLabel("Filter name").fill(tag);
			await page.getByRole("button", { name: "Always do this" }).click();

			await expect(page.getByText("Filter saved")).toBeVisible({
				timeout: 15_000,
			});
			await page.getByRole("button", { name: "Done" }).click();
			await expect(selectionSheet(page)).toBeHidden();
		} finally {
			await cleanup();
		}
	});

	test("a widen that matches nothing falls back to organizing the selection", async ({
		page,
		run,
		api,
	}) => {
		const { first, second, cleanup } = await seedScratch(
			page,
			run,
			api,
			`organize-fallback ${Date.now()}`,
		);

		await stubPreview(page, { matchedCount: 0, messageIds: [] });

		try {
			await selectTwoAndExpand(page, first, second);
			await selectSimilarButton(page).click();

			// No dead end: the sentence says it is organizing just the selection.
			await expect(page.getByText(/No similar messages found/)).toBeVisible();
			await expect(
				page.getByText(/organizing just your 2 selected/),
			).toBeVisible();

			await destinationSelect(page).selectOption({ label: "Archive" });
			// The fallback defaults to the "Just these" scope — a real move.
			await page.getByRole("button", { name: /Move 2 messages/ }).click();

			await expect(selectionSheet(page)).toBeHidden();
			// Single-pane mobile stays on the list — the move must not open a neighbour.
			await expect(page).not.toHaveURL(/selectedMessageId=/);
			await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
				timeout: 15_000,
			});
		} finally {
			await cleanup();
		}
	});

	test("Something else seeds the sentence from a shortcut", async ({
		page,
		run,
		api,
	}) => {
		const { first, second, cleanup } = await seedScratch(
			page,
			run,
			api,
			`organize-else ${Date.now()}`,
		);

		await stubPreview(page, {
			matchedCount: 5,
			messageIds: ["stub-1", "stub-2", "stub-3", "stub-4", "stub-5"],
		});

		try {
			await selectTwoAndExpand(page, first, second);
			await somethingElseButton(page).click();

			await expect(page.getByText("What should Remit do?")).toBeVisible();
			await expect(
				page.getByPlaceholder("Tell Remit what to do…"),
			).toBeVisible();

			// A shortcut seeds the folder, then the flow widens into the sentence.
			await page.getByRole("button", { name: "File in Archive" }).click();
			await expect(page.getByText(/5 similar messages found/)).toBeVisible();

			// The seeded folder carried through, so the commit is actionable
			// without re-picking one.
			await expect(
				page.getByRole("button", { name: /Organize 5 messages/ }),
			).toBeEnabled();
		} finally {
			await cleanup();
		}
	});
});
