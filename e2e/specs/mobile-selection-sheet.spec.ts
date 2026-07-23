/**
 * Mobile selection sheet (issue #210).
 *
 * The mobile multi-select surface is a peeking bottom sheet, not the old top
 * bar: selecting two or more rows raises a slim teaser; a tap expands it to the
 * quick actions (Delete / Move / Junk) and the select-similar entries; a tap
 * collapses it back with the selection intact. This spec drives that surface
 * end to end against the real backend — a delete through the sheet actually
 * removes the rows, a move actually files them — and restores the shared
 * inbox's baseline count that the serial suite depends on.
 */
import type { Locator, Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE });

const rows = (page: Page): Locator => page.locator("[data-message-row]");

/**
 * A long press with real pointer events, the same input the row's 500ms timer
 * listens for (Chromium dispatches PointerEvents for mouse input).
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

/** In selection mode a row's leading slot is a "Select/Deselect message" button. */
const rowToggle = (row: Locator): Locator =>
	row.getByRole("button", { name: /^(Select|Deselect) message$/ });

/** The peeking sheet, identified by its stable data hook. */
const selectionSheet = (page: Page): Locator =>
	page.locator("[data-selection-sheet]");

const grabber = (page: Page): Locator =>
	page.getByRole("slider", { name: /(Expand|Collapse) selection actions/ });

const cancelSelectionButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Cancel selection" });

const deleteButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages to Trash" });

const moveButton = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages", exact: true });

/** The sheet's count/status line (its first `role="status"`). */
const selectionStatus = (page: Page): Locator =>
	selectionSheet(page).getByRole("status").first();

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

const gotoInbox = async (page: Page, mailboxId: string): Promise<void> => {
	await page.goto(`/mail/${mailboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

/** Select the two given rows so the teaser rises. */
const selectTwo = async (page: Page, a: Locator, b: Locator): Promise<void> => {
	await longPress(page, a);
	await rowToggle(b).click();
	await expect(selectionSheet(page)).toBeVisible();
	await expect(selectionStatus(page)).toHaveText("2 messages selected");
};

test.describe("Mobile selection sheet", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
			timeout: 30_000,
		});
	});

	test("the teaser rises at two selected, not at one", async ({ page }) => {
		await longPress(page, rows(page).first());
		// One selected: selection mode is entered (the row shows its toggle) but
		// the sheet stays down — the prototype's two-row threshold.
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
		await expect(selectionSheet(page)).toBeHidden();

		await rowToggle(rows(page).nth(1)).click();
		await expect(selectionSheet(page)).toBeVisible();
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(page.getByText("Swipe up for actions")).toBeVisible();
	});

	test("expands and collapses by tap; the selection survives both", async ({
		page,
	}) => {
		await selectTwo(page, rows(page).first(), rows(page).nth(1));

		await grabber(page).click();
		await expect(deleteButton(page)).toBeVisible();
		await expect(cancelSelectionButton(page)).toBeVisible();

		await grabber(page).click();
		await expect(page.getByText("Swipe up for actions")).toBeVisible();
		// The selection is unchanged across the collapse.
		await expect(selectionStatus(page)).toHaveText("2 messages selected");
		await expect(rowToggle(rows(page).first())).toHaveAccessibleName(
			"Deselect message",
		);
	});

	test("Cancel in the expanded sheet exits selection", async ({ page }) => {
		await selectTwo(page, rows(page).first(), rows(page).nth(1));
		await expandSheet(page);

		await cancelSelectionButton(page).click();

		await expect(selectionSheet(page)).toBeHidden();
	});

	test("Delete via the sheet removes the rows and keeps the list", async ({
		page,
		run,
		api,
	}) => {
		// Scratch messages, not the globally seeded set: the serial suite asserts
		// the inbox holds exactly `seededSubjects`, so this appends its own, deletes
		// them through the sheet, and the count check restores the baseline.
		const tag = `sheet-delete ${Date.now()}`;
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

		const first = page
			.locator("[data-message-row]")
			.filter({ hasText: subjects[0] });
		const second = page
			.locator("[data-message-row]")
			.filter({ hasText: subjects[1] });
		await selectTwo(page, first, second);
		await expandSheet(page);

		await deleteButton(page).click();
		const dialog = confirmDialog(page);
		await expect(dialog).toHaveAccessibleName("Move 2 messages to Trash?");
		await dialog.getByRole("button", { name: "Move to Trash" }).click();

		await expect(selectionSheet(page)).toBeHidden();
		// Single-pane mobile stays on the list — the delete must not open a
		// neighbour (#202) — and the completion banner is the signal it landed.
		await expect(page).not.toHaveURL(/selectedMessageId=/);
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

	test("Move via the sheet files the messages and clears the selection", async ({
		page,
		run,
		api,
	}) => {
		const tag = `sheet-move ${Date.now()}`;
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

		const first = page
			.locator("[data-message-row]")
			.filter({ hasText: subjects[0] });
		const second = page
			.locator("[data-message-row]")
			.filter({ hasText: subjects[1] });
		await selectTwo(page, first, second);
		await expandSheet(page);

		await moveButton(page).click();
		// Junk is always appointed on this account (the spam fixture seeds into
		// it), so it is a reliable move destination through the picker.
		await page.getByRole("option", { name: "Move to Junk" }).click();

		await expect(selectionSheet(page)).toBeHidden();
		// The moved rows leave the inbox, restoring the baseline the suite expects.
		await expect(async () => {
			await page.reload();
			await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
				timeout: 5_000,
			});
		}).toPass({ timeout: 60_000 });
		for (const subject of subjects) {
			await expect(page.getByText(subject, { exact: true })).toBeHidden();
		}

		// Clean up the filed scratch out of Junk so the run leaves no scraps.
		const mailboxes = await api.listMailboxes(run.accountId);
		const junk = mailboxes.find((m) => m.fullPath === "Junk");
		if (junk) {
			await waitFor(
				() => api.searchMatchingMessageIds(junk.mailboxId, tag),
				(ids) => ids.length === subjects.length,
				{ timeoutMs: 60_000, what: "the moved scratch to land in Junk" },
			);
			const ids = await api.searchMatchingMessageIds(junk.mailboxId, tag);
			await api.deleteMessages(ids);
		}
	});
});
