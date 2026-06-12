import { expect, test } from "@playwright/test";

/**
 * Onboarding welcome screen baseline.
 *
 * Guards the regression from issue #560: WizardShell centering was broken
 * when remit-ui classes weren't scanned by Tailwind due to an incorrect
 * @source glob in index.css pointing at a non-existent
 * packages/remit-web-client/node_modules/ path (workspace hoisting moves
 * @remit/ui to the repo root node_modules). The fix aligns the path
 * with the working Storybook config so WizardShell utilities (pt-[30vh],
 * card centering, raised variant) are generated.
 */
test.describe("visual: onboarding", () => {
	test("welcome step renders centered", async ({ page }) => {
		await page.goto("/onboarding");
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveScreenshot("onboarding-welcome.png", {
			fullPage: false,
		});
	});
});
