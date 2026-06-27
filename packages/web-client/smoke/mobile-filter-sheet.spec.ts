import { expect, test } from "./fixtures/account-setup.js";

/**
 * Mobile regression suite for the collapsible filter sheet in the daily brief.
 *
 * The FilterSheet wraps the message list on mobile (<1024px). It starts
 * collapsed so the brief list stays visible on load (#843); the summary bar
 * taps to expand the source/account, category and attribute filters, and taps
 * again to collapse the drawer.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe("Mobile filter sheet", () => {
	test.use({ viewport: MOBILE_VIEWPORT });

	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");

		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar).toBeVisible({ timeout: 15_000 });
	});

	test("sheet is collapsed by default — pills hidden, brief content visible on load", async ({
		page,
	}) => {
		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar).toBeVisible();
		await expect(summaryBar).toHaveAttribute("aria-expanded", "false");

		const heading = page.getByRole("heading", { name: /daily brief/i });
		await expect(heading).toBeVisible();

		await expect(
			page.getByRole("button", { name: "Personal", exact: true }),
		).not.toBeInViewport();
		await expect(
			page.getByRole("button", { name: "Unread" }),
		).not.toBeInViewport();
	});

	test("expanding then re-collapsing the summary bar shows and hides the category and attribute pills", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();

		const collapseBar = page.getByRole("button", { name: "Collapse filters" });
		await expect(collapseBar).toBeVisible({ timeout: 3_000 });
		await expect(collapseBar).toHaveAttribute("aria-expanded", "true");

		await expect(
			page.getByRole("button", { name: "Personal", exact: true }),
		).toBeInViewport({ timeout: 3_000 });
		await expect(page.getByRole("button", { name: "Unread" })).toBeInViewport({
			timeout: 3_000,
		});
		await expect(
			page.getByRole("button", { name: "Flagged" }),
		).toBeInViewport();

		await collapseBar.click();

		const expandBar = page.getByRole("button", { name: "Expand filters" });
		await expect(expandBar).toBeVisible({ timeout: 3_000 });
		await expect(expandBar).toHaveAttribute("aria-expanded", "false");
		await expect(
			page.getByRole("button", { name: "Personal", exact: true }),
		).not.toBeInViewport();
	});

	test("selecting a category and toggling an attribute filter reflects in the collapsed summary", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();
		await expect(
			page.getByRole("button", { name: "Collapse filters" }),
		).toBeVisible({ timeout: 3_000 });

		await page.getByRole("button", { name: "Newsletter", exact: true }).click();
		await page.getByRole("button", { name: "Unread" }).click();

		await page.getByRole("button", { name: "Collapse filters" }).click();
		await expect(
			page.getByRole("button", { name: "Expand filters" }),
		).toBeVisible({ timeout: 3_000 });

		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar.getByText("Newsletter")).toBeVisible();
		await expect(summaryBar.getByText("Unread")).toBeVisible();

		await expect(
			page.getByRole("button", { name: "Clear filters" }),
		).toBeVisible();
	});

	test("Clear filters resets state — summary returns to neutral and clear button disappears", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();
		await expect(
			page.getByRole("button", { name: "Collapse filters" }),
		).toBeVisible({ timeout: 3_000 });

		await page.getByRole("button", { name: "Unread" }).click();

		await page.getByRole("button", { name: "Collapse filters" }).click();
		await expect(
			page.getByRole("button", { name: "Expand filters" }),
		).toBeVisible({ timeout: 3_000 });

		const clearButton = page.getByRole("button", { name: "Clear filters" });
		await expect(clearButton).toBeVisible();
		await clearButton.click();

		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar.getByText("Filters")).toBeVisible({
			timeout: 3_000,
		});

		await expect(
			page.getByRole("button", { name: "Clear filters" }),
		).toBeHidden();
	});

	test("tapping the summary bar expands the default-collapsed sheet", async ({
		page,
	}) => {
		const expandBar = page.getByRole("button", { name: "Expand filters" });
		await expect(expandBar).toBeVisible({ timeout: 3_000 });

		await expect(
			page.getByRole("button", { name: "Personal", exact: true }),
		).not.toBeInViewport();

		await expandBar.click();

		await expect(
			page.getByRole("button", { name: "Collapse filters" }),
		).toBeVisible({ timeout: 3_000 });

		await expect(
			page.getByRole("button", { name: "Personal", exact: true }),
		).toBeInViewport({ timeout: 3_000 });
	});

	test("expanded filter pill rows wrap rather than scroll — the last pill of each row stays in the viewport", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();
		await expect(
			page.getByRole("button", { name: "Collapse filters" }),
		).toBeVisible({ timeout: 3_000 });

		// Wrapped pills stay visible; a horizontally-scrolled row pushes its last
		// pill off-screen-right. Automated is the last category, Flagged the last
		// attribute filter.
		await expect(
			page.getByRole("button", { name: "Automated", exact: true }),
		).toBeInViewport({ timeout: 3_000 });
		await expect(
			page.getByRole("button", { name: "Flagged" }),
		).toBeInViewport();
	});
});
