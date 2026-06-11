/**
 * Drafts view smoke tests — issue #505.
 *
 * Verifies the segmented Drafts folder view:
 *  - The sidebar no longer shows a standalone "Drafts" header/section.
 *  - Opening the account's IMAP \Drafts mailbox renders BOTH labeled sections
 *    ("Not yet sent (Remit)" + "On the server") when both sources have data.
 *  - Clicking a Remit-draft row opens compose (the edit path).
 *  - Clicking an IMAP-draft row opens the reading pane (read-only).
 *
 * The seeder (global-setup.ts) seeds one IMAP \Drafts message and one Remit
 * outbox draft for the test account so both sections render.
 */
import { expect, test } from "./fixtures/account-setup.js";

const openDraftsMailbox = async (
	page: import("@playwright/test").Page,
): Promise<import("@playwright/test").Locator> => {
	await page.goto("/mail");

	const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
	await expect(sidebar).toBeVisible({ timeout: 15_000 });

	const draftsLink = sidebar.getByRole("link", { name: /drafts/i });
	await expect(draftsLink).toBeVisible({ timeout: 10_000 });
	await draftsLink.click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	return sidebar;
};

test.describe("Drafts view (#505)", () => {
	test("sidebar does NOT show a standalone Drafts header", async ({ page }) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		// The old DraftsList rendered a collapsible button labeled "Drafts".
		// After this change there must be no such standalone section header.
		// (The IMAP \Drafts mailbox link is still in the sidebar — that is an
		// <a> nav link, not a collapsible button section.)
		const draftsSection = sidebar.getByRole("button", { name: /^drafts$/i });
		await expect(draftsSection).toBeHidden();
	});

	test("opening Drafts renders both labeled sections", async ({ page }) => {
		await openDraftsMailbox(page);

		// Both sectioned headers must render with seeded data on both sides.
		await expect(page.getByText("Not yet sent (Remit)")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByText("On the server")).toBeVisible({
			timeout: 10_000,
		});

		// The seeded rows are present.
		await expect(page.getByText("Unsent Remit draft")).toBeVisible();
		await expect(page.getByText("Server draft reply")).toBeVisible();
	});

	test("clicking a Remit-draft row opens compose", async ({ page }) => {
		await openDraftsMailbox(page);

		const remitRow = page.getByText("Unsent Remit draft");
		await expect(remitRow).toBeVisible({ timeout: 10_000 });
		await remitRow.click();

		// Compose surface opens (Send button is the reliable compose tell).
		await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
			timeout: 10_000,
		});
	});

	test("clicking an IMAP-draft row opens the reading pane", async ({
		page,
	}) => {
		await openDraftsMailbox(page);

		const imapRow = page.getByText("Server draft reply");
		await expect(imapRow).toBeVisible({ timeout: 10_000 });
		await imapRow.click();

		// Reading pane (ConversationView renders the sole article role).
		await page.waitForURL(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });
	});
});
