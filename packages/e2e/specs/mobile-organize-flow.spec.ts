/**
 * Guided mobile organize flow (issue #211).
 *
 * Organize on the selection bar widens the selection with the read-only
 * matcher, shows a brief widening state, then opens the filter-rule chip editor
 * (RFC 038 D1) on that widened set. "Something else" is the same flow entered
 * from the bar's overflow menu, seeded by a shortcut instead of a widen. The editor commits at one of three scopes —
 * apply once, keep doing this, or until a date. This spec drives that surface
 * end to end on a mobile viewport.
 *
 * The widen is a semantic query, and the vector index is deliberately not built
 * on the e2e lane (see issue #219 and organize-standing-filter.spec.ts). So the
 * `POST /organize/preview` response is stubbed per scenario to control the
 * matched set — the semantic matcher itself is covered by the colocated
 * mobile-organize-flow unit tests. Downstream of the editor, the one-time
 * back-apply job and the standing filter, both of which re-run the same absent
 * index server-side, are stubbed so the flow's progress and success states are
 * exercised deterministically. Real filter CRUD is covered by
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

const selectionBar = (page: Page): Locator =>
	page.locator("[data-selection-bar]");

/** The bar's count line, which is up only while rows are ticked. Located by
 *  its own hook: the bar also holds the search field, whose own live region
 *  would otherwise answer to `role="status"` first. */
const selectionStatus = (page: Page): Locator =>
	page.locator("[data-selection-count]");

/** "Something else" is an overflow verb, reached through the bar's kebab. */
const somethingElse = async (page: Page): Promise<void> => {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Something else" }).click();
};

/** The bar's Organize verb, which opens the guided flow on the selection. */
const organizeButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Organize selected messages" });

const destinationSelect = (page: Page): Locator =>
	page.getByLabel("Destination folder");

const gotoInbox = async (page: Page, mailboxId: string): Promise<void> => {
	await page.goto(`/mail/${mailboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

/** Select the two given rows, so the bar carries the verbs. */
const selectTwo = async (page: Page, a: Locator, b: Locator): Promise<void> => {
	await longPress(page, a);
	await rowToggle(b).click();
	await expect(selectionStatus(page)).toBeVisible();
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
			await selectTwo(page, first, second);
			await organizeButton(page).click();

			await expect(page.getByText("Finding similar messages…")).toBeVisible();
			await expect(page.getByText(/2 messages match/)).toBeVisible();

			await destinationSelect(page).selectOption({ label: "Archive" });
			// One-time apply is the default scope.
			await page.getByRole("button", { name: "Apply now" }).click();

			await expect(page.getByText(/2 of 2 moved/)).toBeVisible({
				timeout: 15_000,
			});
			await page.getByRole("button", { name: "Done" }).click();
			await expect(selectionStatus(page)).toBeHidden();
		} finally {
			await cleanup();
		}
	});

	test("Select similar commits a standing filter, then back-applies it", async ({
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
		// Creating a standing filter now runs the retroactive back-apply, so the
		// commit flows into the same job the one-time scope runs. The job re-uses
		// the absent index server-side, so it is stubbed exactly as the one-time
		// case above: create returns a running job, the poll returns it complete.
		await page.route(/\/organize$/, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					organizeJobId: "job-1",
					state: "Running",
					matchedCount: 3,
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
					matchedCount: 3,
					appliedCount: 3,
					failedCount: 0,
				}),
			}),
		);

		try {
			await selectTwo(page, first, second);
			await organizeButton(page).click();

			await expect(page.getByText(/3 messages match/)).toBeVisible();

			await destinationSelect(page).selectOption({ label: "Archive" });
			// The scope control's radios are sr-only; the visible label is the click
			// surface (what a user taps), so drive it, not the hidden input.
			await page.getByText("Keep doing this", { exact: true }).click();
			await page.getByLabel("Rule name").fill(tag);
			await page.getByRole("button", { name: "Save rule" }).click();

			// The rule saved, then its back-apply moved the mail already matching —
			// the summary the standing scope now reaches, not a bare "Filter saved".
			await expect(page.getByText(/3 of 3 moved/)).toBeVisible({
				timeout: 15_000,
			});
			await page.getByRole("button", { name: "Done" }).click();
			await expect(selectionStatus(page)).toBeHidden();
		} finally {
			await cleanup();
		}
	});

	test("a widen that matches nothing opens an honest, still-applicable rule", async ({
		page,
		run,
		api,
	}) => {
		const { first, second, cleanup } = await seedScratch(
			page,
			run,
			api,
			`organize-empty ${Date.now()}`,
		);

		await stubPreview(page, { matchedCount: 0, messageIds: [] });
		// Applying an empty rule is still a one-time back-apply job; it just moves
		// nothing. Stub it so the flow stays deterministic on the index-free lane.
		await page.route(/\/organize$/, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					organizeJobId: "job-1",
					state: "Running",
					matchedCount: 0,
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
					matchedCount: 0,
					appliedCount: 0,
					failedCount: 0,
				}),
			}),
		);

		try {
			await selectTwo(page, first, second);
			await organizeButton(page).click();

			// No dead end: the editor opens and states the empty count plainly.
			await expect(page.getByText(/No mail matches yet/)).toBeVisible();

			await destinationSelect(page).selectOption({ label: "Archive" });
			await page.getByRole("button", { name: "Apply now" }).click();

			await expect(page.getByText(/0 of 0 moved/)).toBeVisible({
				timeout: 15_000,
			});
			await page.getByRole("button", { name: "Done" }).click();
			await expect(selectionStatus(page)).toBeHidden();
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
			await selectTwo(page, first, second);
			await somethingElse(page);

			await expect(page.getByText("What should Remit do?")).toBeVisible();
			await expect(
				page.getByPlaceholder("Tell Remit what to do…"),
			).toBeVisible();

			// A shortcut seeds the folder, then the flow widens into the editor.
			await page.getByRole("button", { name: "File in Archive" }).click();
			await expect(page.getByText(/5 messages match/)).toBeVisible();

			// The seeded folder carried through, so the commit is actionable
			// without re-picking one.
			await expect(
				page.getByRole("button", { name: "Apply now" }),
			).toBeEnabled();
		} finally {
			await cleanup();
		}
	});
});
