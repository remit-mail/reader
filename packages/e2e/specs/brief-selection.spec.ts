/**
 * Selection in the Daily brief (#203).
 *
 * The brief renders its own rows through the kit's section components, a
 * different surface from the mailbox list's virtualizer. The phone brief used
 * to mount those rows without the bulk verbs, so a selection could be made but
 * raised no action bar — selectable, and nothing to do with it. The brief now
 * mounts the mailbox list's selection surface, so these assert the brief's
 * selection behaves exactly as the inbox's does: the peeking sheet rises at two
 * selected and not at one, and its Delete acts on the selection.
 *
 * Driven at the tablet width the bug was reported on (800×1106): still a
 * single-pane layout (< 1024px), so the touch selection sheet is the surface,
 * and wide enough (≥ 640px) that the row's leading selection toggle is laid out
 * and tappable — so selection is entered with a tap on it, not a long press.
 * Scratch messages, tagged per run, are appended and deleted through the UI so
 * the shared serial inbox other specs count exactly is left as it was.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";

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

/** The peeking sheet, identified by its stable data hook. */
const selectionSheet = (page: Page): Locator =>
	page.locator("[data-selection-sheet]");

/** The sheet's count/status line (its first `role="status"`). */
const selectionStatus = (page: Page): Locator =>
	selectionSheet(page).getByRole("status").first();

const grabber = (page: Page): Locator =>
	page.getByRole("slider", { name: /(Expand|Collapse) selection actions/ });

const cancelSelectionButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Cancel selection" });

const deleteButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages to Trash" });

const confirmDialog = (page: Page): Locator => page.getByRole("dialog");

/** Tap the grabber to expand the sheet, until the in-sheet actions are reachable. */
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

	test("selecting in the brief raises the action sheet and Delete acts on the selection", async ({
		page,
		run,
		api,
	}) => {
		await rowToggle(briefRow(page, subjects[0])).click();
		// One selected: selection mode is entered but the sheet stays down — the
		// mailbox list's threshold, which the brief now shares.
		await expect(rowToggle(briefRow(page, subjects[0]))).toHaveAccessibleName(
			"Deselect message",
		);
		await expect(selectionSheet(page)).toBeHidden();

		await rowToggle(briefRow(page, subjects[1])).click();
		// The action sheet exists at all — the whole of #203.
		await expect(selectionSheet(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(page).not.toHaveURL(/selectedMessageId=/);

		await expandSheet(page);
		await deleteButton(page).click();
		const dialog = confirmDialog(page);
		await expect(dialog).toHaveAccessibleName("Move 2 messages to Trash?");
		await dialog.getByRole("button", { name: "Move to Trash" }).click();

		// The brief stays on the list — no message opens — and the selected rows
		// leave it.
		await expect(page).not.toHaveURL(/selectedMessageId=/);
		await expect(selectionSheet(page)).toBeHidden();
		await expect(briefRow(page, subjects[0])).toBeHidden();
		await expect(briefRow(page, subjects[1])).toBeHidden();

		// The backend agrees the two scratch messages are gone, not just the UI.
		await expect(async () => {
			const remaining = await api.searchMatchingMessageIds(run.inboxId, tag);
			expect(remaining).toHaveLength(0);
		}).toPass({ timeout: 30_000 });
	});
});
