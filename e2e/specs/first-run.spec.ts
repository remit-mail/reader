/**
 * The path a person actually takes on a fresh deployment, driven entirely
 * through the browser: create an identity, then be handed the onboarding wizard
 * because no mailbox is connected yet. Runs without the shared signed-in state.
 *
 * One sign-up per run, on purpose — better-auth rate-limits registration, and a
 * spec that trips that limit fails for a reason that has nothing to do with what
 * it is testing.
 */
import { expect, test } from "../src/fixtures.js";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("First run", () => {
	test("signing up leads a mailbox-less user through the onboarding wizard", async ({
		page,
	}) => {
		await page.goto("/");
		await page
			.getByRole("button", { name: "Create account", exact: true })
			.first()
			.click();

		await page.getByLabel("Name").fill("First Run");
		await page.getByLabel("Email").fill(`first-run-${Date.now()}@remit.test`);
		await page.getByLabel("Password").fill("first-run-password-1234");
		await page.locator('form button[type="submit"]').click();

		// No account is connected, so the app must offer to connect one rather
		// than dropping the user into an empty mail view.
		await expect(
			page.getByRole("heading", { name: /welcome to remit/i }),
		).toBeVisible({ timeout: 30_000 });

		await page.getByRole("button", { name: /add your first account/i }).click();
		await expect(
			page.getByRole("heading", { name: /how does this account connect/i }),
		).toBeVisible({ timeout: 10_000 });

		await page.getByRole("button", { name: /continue with imap/i }).click();
		await expect(
			page.getByRole("heading", { name: /what's the email address/i }),
		).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('input[type="email"]')).toBeVisible();
	});

	test("an existing user can sign in and reach their mail", async ({
		page,
		run,
	}) => {
		await page.goto("/");
		await page.getByLabel("Email").fill(run.email);
		await page.getByLabel("Password").fill(run.password);
		await page.locator('form button[type="submit"]').click();

		await expect(
			page.getByRole("navigation", { name: "Mailboxes" }),
		).toBeVisible({ timeout: 30_000 });
	});
});
