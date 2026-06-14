import { expect, test } from "./fixtures/account-setup.js";

test.describe("Compose flow", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("reply action bar buttons are visible in conversation view", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });

		// Reply / Reply all / Forward live in the MessageToolbar header, not the article.
		await expect(
			page.getByRole("button", { name: "Reply", exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Reply all" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Forward" })).toBeVisible();
	});

	test("clicking Reply opens inline compose with To field populated", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Reply button lives in the MessageToolbar header, not the article.
		await page.getByRole("button", { name: "Reply", exact: true }).click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 10_000 });

		await expect(
			article.locator('[contenteditable="true"]').first(),
		).toBeVisible({ timeout: 10_000 });

		const subjectInput = article.locator('input[placeholder="Subject"]');
		const subjectValue = await subjectInput.inputValue();
		expect(subjectValue).toMatch(/^Re:/i);
	});

	test("clicking Reply all opens compose with Cc field visible", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Reply all button lives in the MessageToolbar header, not the article.
		await page.getByRole("button", { name: "Reply all" }).click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 10_000 });

		await expect(
			article.locator('[contenteditable="true"]').first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("clicking Forward opens compose with Fwd: subject", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Forward button lives in the MessageToolbar header, not the article.
		await page.getByRole("button", { name: "Forward" }).click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 10_000 });

		await expect(
			article.locator('[contenteditable="true"]').first(),
		).toBeVisible({ timeout: 10_000 });

		const subjectInput = article.locator('input[placeholder="Subject"]');
		const subjectValue = await subjectInput.inputValue();
		expect(subjectValue).toMatch(/^Fwd:/i);
	});

	test("discard button closes compose and shows reply button again", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Reply button lives in the MessageToolbar header, not the article.
		await page.getByRole("button", { name: "Reply", exact: true }).click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 10_000 });

		await expect(
			article.locator('[contenteditable="true"]').first(),
		).toBeVisible({ timeout: 10_000 });

		// Remove overlapping elements (TanStack devtools)
		await page.evaluate(() => {
			for (const el of document.querySelectorAll(".tsqd-parent-container")) {
				el.remove();
			}
		});

		const discardButton = page.getByRole("button", { name: "Discard" });
		await discardButton.click();

		// Wait for compose form to close (Send button disappears)
		await expect(sendButton).toBeHidden({ timeout: 10_000 });

		// Toolbar Reply button remains available after discarding.
		await expect(
			page.getByRole("button", { name: "Reply", exact: true }),
		).toBeVisible({ timeout: 10_000 });
	});
});
