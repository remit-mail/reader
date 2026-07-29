/**
 * Selection in the Daily brief (#203).
 *
 * The brief renders its own rows through the kit's section components, a
 * different surface from the mailbox list's virtualizer. The phone brief used
 * to mount those rows without the bulk verbs, so a selection could be made but
 * raised no action bar — selectable, and nothing to do with it. The brief now
 * mounts the mailbox list's selection surface, so these assert the brief's
 * selection behaves exactly as the inbox's does: the header carries the count
 * and the verbs from the first ticked row, and its Delete acts on the selection.
 *
 * Driven at the tablet width the bug was reported on (800×1106): still a
 * single-pane layout (< 1024px), and wide enough (≥ 640px) that the row's
 * leading selection toggle is laid out and tappable — so selection is entered
 * with a tap on it, not a long press.
 * Scratch messages, tagged per run, are appended and deleted through the UI so
 * the shared serial inbox other specs count exactly is left as it was.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import {
	advanceTo,
	barDelete,
	commitButton,
	dismissRun,
	wizardStep,
} from "../src/wizard.js";

const TABLET = { width: 800, height: 1106 };
test.use({ viewport: TABLET });

const briefRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

/**
 * The row's leading selection toggle — a `role="button"` labelled "Select
 * message" / "Deselect message" (`ui/message-row.tsx`). Tapping it enters
 * selection mode and toggles the row.
 */
const rowToggle = (row: Locator): Locator =>
	row.getByRole("button", { name: /^(Select|Deselect) message$/ });

/** The bar's count line, which is up only while rows are ticked. Located by
 *  its own hook: the bar also holds the search field, whose own live region
 *  would otherwise answer to `role="status"` first. */
const selectionStatus = (page: Page): Locator =>
	page.locator("[data-selection-count]");

test.describe("Daily brief selection (#203)", () => {
	const tag = `briefsel${Date.now()}`;
	const subjects = [
		`Brief selection alpha ${tag}`,
		`Brief selection beta ${tag}`,
	];

	test.beforeEach(async ({ page, run, api }) => {
		await appendMessages(
			run.imapUser,
			subjects.map((subject) => ({ subject })),
		);
		await api.triggerSync(run.accountId);

		await page.goto("/mail");
		await expect(async () => {
			await page.reload();
			for (const subject of subjects) {
				await expect(briefRow(page, subject)).toBeVisible({ timeout: 5_000 });
			}
		}).toPass({ timeout: 60_000 });
	});

	test.afterEach(async ({ api, run }) => {
		// Remove any scratch message the test did not delete, restoring the inbox
		// the rest of the serial suite counts exactly.
		const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
		if (leftover.length > 0) await api.deleteMessages(leftover);
	});

	test("selecting in the brief raises the action bar and Delete acts on the selection", async ({
		page,
		run,
		api,
	}) => {
		await rowToggle(briefRow(page, subjects[0])).click();
		// The bar takes the header's place from the first ticked row.
		await expect(rowToggle(briefRow(page, subjects[0]))).toHaveAccessibleName(
			"Deselect message",
		);
		await expect(selectionStatus(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("1 message selected");

		await rowToggle(briefRow(page, subjects[1])).click();
		// The action bar exists at all — the whole of #203.
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(page).not.toHaveURL(/selectedMessageId=/);

		// Delete opens the wizard, the same surface every other verb opens, and
		// ends on a review screen naming what it covers (#477 1.4).
		await barDelete(page).click();
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 3 · Apply to$/, {
			timeout: 20_000,
		});
		await advanceTo(page, "Review");
		await expect(page.getByText(/Delete 2 messages/)).toBeVisible();
		await commitButton(page, "Delete").click();
		await expect(page.getByText("Deleted 2")).toBeVisible({ timeout: 30_000 });
		await dismissRun(page);

		// The brief stays on the list — no message opens — and the selected rows
		// leave it.
		await expect(page).not.toHaveURL(/selectedMessageId=/);
		await expect(selectionStatus(page)).toBeHidden();
		await expect(briefRow(page, subjects[0])).toBeHidden();
		await expect(briefRow(page, subjects[1])).toBeHidden();

		// The backend agrees the two scratch messages are gone, not just the UI.
		await expect(async () => {
			const remaining = await api.searchMatchingMessageIds(run.inboxId, tag);
			expect(remaining).toHaveLength(0);
		}).toPass({ timeout: 30_000 });
	});
});
