import { expect, test } from "./fixtures/account-setup.js";

/**
 * Mobile regression suite for the collapsible filter sheet in the daily brief.
 *
 * The FilterSheet wraps the message list on mobile (<1024px). It starts
 * collapsed; the summary bar taps to expand/collapse the category and
 * attribute filter drawers.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe("Mobile filter sheet", () => {
	test.use({ viewport: MOBILE_VIEWPORT });

	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");

		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar).toBeVisible({ timeout: 15_000 });
	});

	test("sheet is collapsed by default — summary bar visible, filter pills hidden", async ({
		page,
	}) => {
		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar).toBeVisible();
		await expect(summaryBar).toHaveAttribute("aria-expanded", "false");

		const heading = page.getByRole("heading", { name: /daily brief/i });
		await expect(heading).toBeVisible();

		const personalButton = page.getByRole("button", { name: "Personal" });
		await expect(personalButton).not.toBeInViewport();
	});

	test("tapping summary bar expands sheet and shows category and attribute pills", async ({
		page,
	}) => {
		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await summaryBar.click();

		const collapseBar = page.getByRole("button", { name: "Collapse filters" });
		await expect(collapseBar).toBeVisible({ timeout: 3_000 });
		await expect(collapseBar).toHaveAttribute("aria-expanded", "true");

		await expect(page.getByRole("button", { name: "Personal" })).toBeInViewport(
			{
				timeout: 3_000,
			},
		);

		await expect(page.getByRole("button", { name: "Unread" })).toBeInViewport({
			timeout: 3_000,
		});
		await expect(
			page.getByRole("button", { name: "Has attachment" }),
		).toBeInViewport();
	});

	test("selecting a category and toggling an attribute filter reflects in the collapsed summary", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();
		await expect(
			page.getByRole("button", { name: "Collapse filters" }),
		).toBeVisible({ timeout: 3_000 });

		await page.getByRole("button", { name: "Newsletters" }).click();
		await page.getByRole("button", { name: "Unread" }).click();

		await page.getByRole("button", { name: "Collapse filters" }).click();
		await expect(
			page.getByRole("button", { name: "Expand filters" }),
		).toBeVisible({ timeout: 3_000 });

		const summaryBar = page.getByRole("button", { name: "Expand filters" });
		await expect(summaryBar.getByText("Newsletters")).toBeVisible();
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

	test("tapping the summary bar again collapses the expanded sheet", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();
		const collapseBar = page.getByRole("button", { name: "Collapse filters" });
		await expect(collapseBar).toBeVisible({ timeout: 3_000 });

		await expect(
			page.getByRole("button", { name: "Personal" }),
		).toBeInViewport();

		await collapseBar.click();

		await expect(
			page.getByRole("button", { name: "Expand filters" }),
		).toBeVisible({ timeout: 3_000 });

		await expect(
			page.getByRole("button", { name: "Personal" }),
		).not.toBeInViewport();
	});

	test("expanded filter pill rows wrap rather than scroll — the last pill of each row stays in the viewport", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Expand filters" }).click();
		await expect(
			page.getByRole("button", { name: "Collapse filters" }),
		).toBeVisible({ timeout: 3_000 });

		// Wrapped pills stay visible; a horizontally-scrolled row pushes its last
		// pill off-screen-right. Transactional is the last category, Today the last
		// attribute filter.
		await expect(
			page.getByRole("button", { name: "Transactional" }),
		).toBeInViewport({ timeout: 3_000 });
		await expect(page.getByRole("button", { name: "Today" })).toBeInViewport();
	});
});
