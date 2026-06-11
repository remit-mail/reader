/**
 * Smoke tests for the onboarding wizard (#354).
 *
 * These tests verify that:
 * 1. /onboarding renders the wizard UI (welcome step)
 * 2. The wizard navigation works (Welcome → Connector → Address steps)
 * 3. /mail with a seeded account does NOT redirect to onboarding
 *
 * Full flow (test-connection + POST /accounts + sync polling) requires
 * a live IMAP server and is covered in e2e tests.
 */
import { expect, test } from "./fixtures/account-setup.js";

test.describe("Onboarding wizard", () => {
	test("renders welcome step at /onboarding", async ({ page }) => {
		await page.goto("/onboarding");

		// Welcome step: title and CTA button
		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 10_000 });
		await expect(
			page.getByRole("button", { name: /add your first account/i }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("advances from welcome to connector picker", async ({ page }) => {
		await page.goto("/onboarding");

		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 10_000 });

		// Click "Add your first account" to advance
		await page.getByRole("button", { name: /add your first account/i }).click();

		// Connector picker should now be visible
		await expect(
			page.getByRole("heading", { name: /how does this account connect/i }),
		).toBeVisible({ timeout: 5_000 });

		// IMAP tile is active (selected)
		await expect(page.getByText("IMAP / SMTP")).toBeVisible();
		// Gmail and Outlook are disabled "soon" tiles
		await expect(page.getByText("Gmail")).toBeVisible();
		await expect(page.getByText("Outlook")).toBeVisible();
	});

	test("advances from connector picker to address entry", async ({ page }) => {
		await page.goto("/onboarding");
		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 10_000 });

		// Welcome → Connector
		await page.getByRole("button", { name: /add your first account/i }).click();
		await expect(
			page.getByRole("heading", { name: /how does this account connect/i }),
		).toBeVisible({ timeout: 5_000 });

		// Connector → Address
		await page.getByRole("button", { name: /continue with imap/i }).click();
		await expect(
			page.getByRole("heading", { name: /what's the email address/i }),
		).toBeVisible({ timeout: 5_000 });

		// Email input should be present
		await expect(page.locator('input[type="email"]')).toBeVisible();
	});

	test("Go Back from connector picker goes back to welcome", async ({
		page,
	}) => {
		await page.goto("/onboarding");
		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 10_000 });

		await page.getByRole("button", { name: /add your first account/i }).click();
		await expect(
			page.getByRole("heading", { name: /how does this account connect/i }),
		).toBeVisible({ timeout: 5_000 });

		// Back button should return to welcome
		await page.getByRole("button", { name: /^back$/i }).click();
		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("/mail with seeded account stays in mail (no wizard)", async ({
		page,
	}) => {
		await page.goto("/mail");

		// The seeded account means the first-run guard must NOT fire — the
		// user lands in the mail UI (daily brief), never the onboarding wizard.
		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });
		expect(page.url()).not.toContain("/onboarding");
	});

	test("step rail shows correct steps", async ({ page }) => {
		await page.goto("/onboarding");
		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 10_000 });

		// Advance to connector step where the rail is shown
		await page.getByRole("button", { name: /add your first account/i }).click();
		await expect(
			page.getByRole("heading", { name: /how does this account connect/i }),
		).toBeVisible({ timeout: 5_000 });

		// Step rail should show step labels (target the ordered list rail items)
		const rail = page.getByRole("list").first();
		await expect(rail.getByText("Connector", { exact: true })).toBeVisible();
		await expect(rail.getByText("Address", { exact: true })).toBeVisible();
		await expect(rail.getByText("Servers", { exact: true })).toBeVisible();
	});
});
