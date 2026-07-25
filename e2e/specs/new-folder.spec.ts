/**
 * Creating a folder from Settings › Folders. The screen composes a name (and an
 * optional parent) into a mailbox create, then refetches the folder list — so a
 * real browser against a real build is the only place the whole path shows: the
 * form submits, the backend queues the mailbox, and the new folder lands in the
 * list. Backend create is covered by unit tests; this asserts the UI wiring.
 */
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };

test.describe("Create folder from settings", () => {
	test.use({ viewport: DESKTOP });

	test("a new folder created from settings appears in the folder list", async ({
		page,
	}) => {
		await page.goto("/settings/folders");

		await expect(
			page.getByRole("heading", { name: "Folder roles" }),
		).toBeVisible({ timeout: 30_000 });

		const name = `E2E Folder ${Date.now()}`;
		const nameField = page
			.getByRole("textbox", { name: "Folder name" })
			.first();
		await expect(nameField).toBeVisible({ timeout: 20_000 });
		await nameField.fill(name);

		await page.getByRole("button", { name: "Create folder" }).first().click();

		await expect(
			page.getByRole("listitem").filter({ hasText: name }),
		).toBeVisible({ timeout: 30_000 });
	});
});
