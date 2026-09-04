/**
 * Organizing through the selection wizard (#483, epic #477).
 *
 * Organize on the selection bar opens the wizard: what the action applies to,
 * where it files, how long it holds, a name if it persists, a review, and a run
 * screen carrying the outcome. This spec drives that surface end to end on a
 * mobile viewport.
 *
 * The semantic widen is a vector query and the index is deliberately not built
 * on the e2e lane (see issue #219 and organize-standing-filter.spec.ts), so the
 * scenarios here take the ticked-list door, whose count is the selection itself
 * and needs no index. Downstream of the review screen, the back-apply job and
 * the filter create both re-run that absent index server-side, so they are
 * stubbed per scenario and the run screen's states are exercised
 * deterministically. Real filter CRUD is covered by
 * organize-standing-filter.spec.ts, and a real folder create against Dovecot by
 * organize-standing-back-apply.spec.ts.
 *
 * Each test appends its own tagged scratch and cleans it up, so the serial
 * suite's exact inbox-count invariant is restored on the way out.
 */
import type { Locator, Page } from "@playwright/test";
import { type ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { deleteSettledMatchesEverywhere } from "../src/sweep.js";
import {
	advanceTo,
	barOrganize,
	commitButton,
	dismissRun,
	expectBlockedReason,
	pickFolder,
	wizardContinue,
	wizardStep,
} from "../src/wizard.js";

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

/** The bar's count line, which is up only while rows are ticked. Located by
 *  its own hook: the bar also holds the search field, whose own live region
 *  would otherwise answer to `role="status"` first. */
const selectionStatus = (page: Page): Locator =>
	page.locator("[data-selection-count]");

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

	// A scenario that filed its scratch leaves it in the destination, so the
	// sweep covers every mailbox — and waits out the move it follows: the rows
	// read as filed while the IMAP copy is still in flight, and the delete is
	// refused against one of those (#1155).
	const cleanup = async () => {
		await deleteSettledMatchesEverywhere(api, run.accountId, tag);
	};

	return { first, second, cleanup };
};

/** The back-apply job, stubbed: create returns a running job, the poll a complete one. */
const stubJob = async (page: Page, matched: number): Promise<void> => {
	await page.route(/\/organize$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				organizeJobId: "job-1",
				state: "Running",
				matchedCount: matched,
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
				matchedCount: matched,
				appliedCount: matched,
				failedCount: 0,
			}),
		}),
	);
};

test.describe("Organize through the selection wizard", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
	});

	test("the ticked list, filed once, runs to a done summary", async ({
		page,
		run,
		api,
	}) => {
		const tag = `wizard-once ${Date.now()}`;
		const { first, second, cleanup } = await seedScratch(page, run, api, tag);

		try {
			await selectTwo(page, first, second);
			await barOrganize(page).click();

			// The ticked list is its own count, and the sample under it is the mail
			// the action covers — never a named match with no members on screen.
			await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Apply to$/, {
				timeout: 20_000,
			});
			await expect(page.getByText("These 2 messages")).toBeVisible();
			await expect(page.getByText("2 messages match")).toBeVisible();

			await advanceTo(page, "Folder");
			await pickFolder(page, "Archive");
			await expect(page.getByText("Moving to Archive.")).toBeVisible();

			await advanceTo(page, "Rule");
			await page.getByText("Just once", { exact: true }).click();
			await advanceTo(page, "Review");

			await expect(page.getByText(/2 messages to Archive/)).toBeVisible();

			await commitButton(page, "Apply now").click();
			await expect(wizardStep(page)).toHaveText(/· Run$/);
			await expect(page.getByText("Organized 2")).toBeVisible({
				timeout: 30_000,
			});

			await dismissRun(page);
			await expect(selectionStatus(page)).toBeHidden();

			// Server truth: the two messages really left the inbox for Archive,
			// not just the screen.
			const mailboxes = await api.listMailboxes(run.accountId);
			const archive = mailboxes.find((m) => m.fullPath === "Archive");
			if (!archive) throw new Error("the account has no Archive mailbox");
			await waitFor(
				() => api.searchMatchingMessageIds(run.inboxId, tag),
				(ids) => ids.length === 0,
				{ timeoutMs: 60_000, what: "the filed scratch to leave the inbox" },
			);
			await waitFor(
				() => api.searchMatchingMessageIds(archive.mailboxId, tag),
				(ids) => ids.length === 2,
				{ timeoutMs: 60_000, what: "the filed scratch to land in Archive" },
			);
		} finally {
			await cleanup();
		}
	});

	test("choosing until a date saves one temporary filter with a zoned expiry", async ({
		page,
		run,
		api,
	}) => {
		const tag = `wizard-until ${Date.now()}`;
		const { first, second, cleanup } = await seedScratch(page, run, api, tag);

		// Every create the flow sends, so "exactly one" is assertable rather than
		// assumed. Real filter CRUD is covered elsewhere; this pins the body.
		const creates: { scope?: string; expiresAt?: string; name?: string }[] = [];
		await page.route(/\/filters$/, async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			creates.push(route.request().postDataJSON());
			await route.fulfill({
				status: 201,
				contentType: "application/json",
				body: JSON.stringify({
					filterId: "filter-1",
					name: tag,
					scope: "Temporary",
				}),
			});
		});
		await stubJob(page, 2);

		try {
			await selectTwo(page, first, second);
			await barOrganize(page).click();
			await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Apply to$/, {
				timeout: 20_000,
			});

			await advanceTo(page, "Folder");
			await pickFolder(page, "Archive");
			await advanceTo(page, "Rule");

			// The scope is the second branching answer: it adds the naming step
			// after the step it is given on.
			await page.getByText("Until a date", { exact: true }).click();
			await expect(wizardStep(page)).toHaveText(/^Step 3 of 6 · Rule$/);
			await page.getByLabel("Stops on").fill("2030-06-30");

			await advanceTo(page, "Name");
			await page.getByLabel("Rule name").fill(tag);
			await advanceTo(page, "Review");

			await commitButton(page, "Save until then").click();
			await expect(wizardStep(page)).toHaveText(/· Run$/);
			await expect(page.getByText("Rule saved and applied")).toBeVisible({
				timeout: 30_000,
			});

			expect(creates).toHaveLength(1);
			expect(creates[0].scope).toBe("Temporary");
			expect(creates[0].name).toBe(tag);
			// The wizard collects a civil date; the draft carries the instant it
			// means, with the zone offset it was picked in (#477 5.4).
			expect(creates[0].expiresAt).toMatch(
				/^2030-06-30T23:59:59[+-]\d{2}:\d{2}$/,
			);

			await dismissRun(page);
			await expect(selectionStatus(page)).toBeHidden();
		} finally {
			await cleanup();
		}
	});

	test("closing while the rule is saving still runs the pass over existing mail", async ({
		page,
		run,
		api,
	}) => {
		const tag = `wizard-close ${Date.now()}`;
		const { first, second, cleanup } = await seedScratch(page, run, api, tag);

		// The create is held long enough for the saving screen — which offers a
		// Close — to be the screen when Close is pressed.
		await page.route(/\/filters$/, async (route) => {
			if (route.request().method() !== "POST") return route.continue();
			await new Promise((resolve) => setTimeout(resolve, 2_000));
			await route.fulfill({
				status: 201,
				contentType: "application/json",
				body: JSON.stringify({
					filterId: "filter-1",
					name: tag,
					scope: "Standing",
				}),
			});
		});

		// The pass over the mail already in the mailbox, counted rather than
		// watched: nothing is on screen to watch it by the time it starts.
		const passes: string[] = [];
		await page.route(/\/organize$/, (route) => {
			passes.push(route.request().url());
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					organizeJobId: "job-1",
					state: "Running",
					matchedCount: 2,
					appliedCount: 0,
					failedCount: 0,
				}),
			});
		});

		try {
			await selectTwo(page, first, second);
			await barOrganize(page).click();
			await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Apply to$/, {
				timeout: 20_000,
			});
			await advanceTo(page, "Folder");
			await pickFolder(page, "Archive");
			await advanceTo(page, "Rule");
			await page.getByText("Keep doing this", { exact: true }).click();
			await advanceTo(page, "Name");
			await page.getByLabel("Rule name").fill(tag);
			await advanceTo(page, "Review");

			await commitButton(page, "Save rule").click();
			await expect(page.getByText("Saving rule…")).toBeVisible({
				timeout: 20_000,
			});

			// Out of the wizard while the create is still in flight. The rule is
			// saved either way; the pass behind it must not be lost with the screen.
			await dismissRun(page, "Close");
			await expect(wizardStep(page)).toHaveCount(0);

			await expect(async () => {
				expect(passes.length).toBeGreaterThan(0);
			}).toPass({ timeout: 20_000 });
		} finally {
			await cleanup();
		}
	});

	test("Continue says what is missing instead of going nowhere", async ({
		page,
		run,
		api,
	}) => {
		const { first, second, cleanup } = await seedScratch(
			page,
			run,
			api,
			`wizard-blocked ${Date.now()}`,
		);

		try {
			await selectTwo(page, first, second);
			await barOrganize(page).click();
			await advanceTo(page, "Folder");

			// Nothing disables: Continue stays pressable, and pressing it says
			// what the step is still missing (#477 1.7).
			await wizardContinue(page).click();
			await expectBlockedReason(page, "Pick a destination first.");
			await expect(wizardStep(page)).toHaveText(/· Folder$/);
		} finally {
			await cleanup();
		}
	});

	test("the free-text organize panel is gone from the bar", async ({
		page,
		run,
		api,
	}) => {
		const { first, second, cleanup } = await seedScratch(
			page,
			run,
			api,
			`wizard-no-else ${Date.now()}`,
		);

		try {
			await selectTwo(page, first, second);
			await page.getByRole("button", { name: "More actions" }).click();
			await expect(
				page.getByRole("menuitem", { name: "Something else" }),
			).toHaveCount(0);
			await expect(
				page.getByRole("menuitem", { name: "Mark read" }),
			).toBeVisible();
		} finally {
			await cleanup();
		}
	});
});
