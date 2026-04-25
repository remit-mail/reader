import { expect, test } from "@playwright/test";

/**
 * Sign-in screen baseline. Covered when Cognito is not configured —
 * the local-dev banner appears and the Amplify Authenticator gate is
 * bypassed. We hit the root `/` which redirects to `/mail`; on a fresh
 * (signed-out) session that lands on the sign-in form OR the local
 * dev mode banner depending on env.
 */
test.describe("visual: sign-in", () => {
	test("root route renders without auth", async ({ page }) => {
		await page.goto("/");
		// Wait for either the auth form (Cognito configured) or the
		// "Select a mailbox" empty state (local dev) — both are stable.
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveScreenshot("signin-or-empty.png", {
			fullPage: false,
		});
	});
});
