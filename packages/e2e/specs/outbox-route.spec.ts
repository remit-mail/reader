/**
 * The outbox is a list route, and it mounts its own shell: the list in one pane
 * and its reading pane as the route below it. Deep-loading it is the only way to
 * see that mounting without a previous list on screen to be mistaken for it.
 *
 * Assert the surface, do something unrelated, then assert it again — a single
 * assertion right after the load passes on a route that mounts once and never
 * again.
 */
import { expect, test } from "../src/fixtures.js";

const sidebar = (page: import("@playwright/test").Page) =>
	page.getByRole("navigation", { name: "Mailboxes", exact: true });

/** Only the outbox's reading pane says this, so it names the mounted route. */
const readingPane = (page: import("@playwright/test").Page) =>
	page.getByText("Select a message to read");

test.describe("The outbox mounts its own shell", () => {
	test("a cold load of /mail/outbox lands there, and stays there", async ({
		page,
	}) => {
		await page.goto("/mail/outbox");
		await expect(sidebar(page)).toBeVisible({ timeout: 20_000 });

		// The address is a list of its own: no redirect on to the brief.
		expect(new URL(page.url()).pathname).toBe("/mail/outbox");
		await expect(readingPane(page)).toBeVisible({ timeout: 30_000 });

		// Walk off the list and back. The reading pane belongs to the route, so it
		// arrives again rather than only on the load that mounted it once.
		await sidebar(page)
			.getByRole("link", { name: /daily brief/i })
			.click();
		await page.waitForURL(/\/mail\/brief/);
		await expect(readingPane(page)).toHaveCount(0);

		await sidebar(page)
			.getByRole("link", { name: /outbox/i })
			.click();
		await page.waitForURL(/\/mail\/outbox/);
		await expect(readingPane(page)).toBeVisible({ timeout: 30_000 });
	});
});
