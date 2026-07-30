/**
 * Creating a folder from Settings › Folders. The screen makes the folder where
 * the user is looking in the tree, waits for the mail server to confirm it, and
 * shows it in place — so a real browser against a real build is the only place
 * the whole path shows: the form submits, the backend queues the mailbox, and
 * the new folder lands in the tree. Backend create is covered by unit tests;
 * this asserts the UI wiring.
 */
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };

test.describe("Create folder from settings", () => {
	test.use({ viewport: DESKTOP });

	test("a new folder created from settings appears in the folder tree", async ({
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

		const name = `E2E Folder ${Date.now()}`;
		await page
			.getByRole("button", { name: "New folder", exact: true })
			.first()
			.click();

		const nameField = page.getByRole("textbox", { name: "Folder name" });
		await expect(nameField).toBeVisible({ timeout: 20_000 });
		await nameField.fill(name);

		await page.getByRole("button", { name: "Create folder" }).click();

		await expect(tree.getByRole("treeitem", { name })).toBeVisible({
			timeout: 60_000,
		});
	});
});
