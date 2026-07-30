/**
 * Deleting a folder from Settings › Folders. A folder is created from the UI,
 * then removed through the delete wizard reached from its own row in the tree:
 * an empty folder is a single destructive confirm that calls the real
 * delete-mailbox endpoint and drops the folder from the tree. The wizard's
 * move-and-delete path needs a folder that already holds synced mail; this
 * stack only syncs mail appended before the account is connected (see the
 * annotated defect in `sync.spec.ts`), and the pre-seeded mail lives only in
 * role-appointed INBOX/Junk/Sent folders, which the wizard guards from deletion
 * — so the batched-move path is exercised by the unit and render tests instead.
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

		const tree = page.getByRole("tree", {
			name: `All folders for ${run.imapUser}`,
		});
		await expect(tree).toBeVisible({ timeout: 30_000 });

		const name = `E2E Delete ${Date.now()}`;
		await page
			.getByRole("button", { name: "New folder", exact: true })
			.first()
			.click();

		const nameField = page.getByRole("textbox", { name: "Folder name" });
		await expect(nameField).toBeVisible({ timeout: 20_000 });
		await nameField.fill(name);
		await page.getByRole("button", { name: "Create folder" }).click();

		const row = tree.getByRole("treeitem", { name });
		await expect(row).toBeVisible({ timeout: 60_000 });

		await page.getByRole("button", { name: `Delete ${name}` }).click();

		const confirm = page.getByRole("button", { name: "Delete folder" });
		await expect(confirm).toBeVisible({ timeout: 10_000 });
		await confirm.click();

		await expect(confirm).toBeHidden({ timeout: 20_000 });
		await expect(row).toHaveCount(0, { timeout: 30_000 });
	});
});
