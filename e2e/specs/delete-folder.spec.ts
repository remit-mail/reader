/**
 * Deleting a folder from Settings › Folders. A folder is created from the UI,
 * then removed through the delete wizard: an empty folder is a single
 * destructive confirm that calls the real delete-mailbox endpoint and drops the
 * folder from the list. The wizard's move-and-delete path needs a folder that
 * already holds synced mail; this stack only syncs mail appended before the
 * account is connected (see the annotated defect in `sync.spec.ts`), and the
 * pre-seeded mail lives only in role-appointed INBOX/Junk/Sent folders, which
 * the wizard guards from deletion — so the batched-move path is exercised by
 * the unit and render tests instead.
 */
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };

test.describe("Delete folder from settings", () => {
	test.use({ viewport: DESKTOP });

	test("an empty folder created from settings can be deleted again", async ({
		page,
		run,
	}) => {
		await page.goto("/settings/folders");

		await expect(
			page.getByRole("heading", { name: "Folder roles", exact: true }),
		).toBeVisible({ timeout: 30_000 });

		const name = `E2E Delete ${Date.now()}`;
		const nameField = page
			.getByRole("textbox", { name: "Folder name" })
			.first();
		await expect(nameField).toBeVisible({ timeout: 20_000 });
		await nameField.fill(name);
		await page.getByRole("button", { name: "Create folder" }).first().click();

		const folderList = page.getByRole("list", {
			name: `All folders for ${run.imapUser}`,
		});
		const row = folderList.getByRole("listitem").filter({ hasText: name });
		await expect(row).toBeVisible({ timeout: 30_000 });

		await row.getByRole("button", { name: `Delete ${name}` }).click();

		const confirm = page.getByRole("button", { name: "Delete folder" });
		await expect(confirm).toBeVisible({ timeout: 10_000 });
		await confirm.click();

		await expect(confirm).toBeHidden({ timeout: 20_000 });
		await expect(row).toHaveCount(0, { timeout: 30_000 });
	});
});
