import { expect, test } from "./fixtures/account-setup.js";

test.describe("Compose flow", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
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

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		await expect(
			article.getByRole("button", { name: "Reply", exact: true }),
		).toBeVisible();
		await expect(
			article.getByRole("button", { name: "Reply all" }),
		).toBeVisible();
		await expect(
			article.getByRole("button", { name: "Forward" }),
		).toBeVisible();
	});

	test("clicking Reply opens inline compose with To field populated", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		const replyButton = article.getByRole("button", {
			name: "Reply",
			exact: true,
		});
		await replyButton.click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 5_000 });

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

		const replyAllButton = article.getByRole("button", {
			name: "Reply all",
		});
		await replyAllButton.click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 5_000 });
	});

	test("clicking Forward opens compose with Fwd: subject", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		const forwardButton = article.getByRole("button", { name: "Forward" });
		await forwardButton.click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 5_000 });

		const subjectInput = article.locator('input[placeholder="Subject"]');
		const subjectValue = await subjectInput.inputValue();
		expect(subjectValue).toMatch(/^Fwd:/i);
	});

	test("discard button closes compose and shows action bar again", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		const replyButton = article.getByRole("button", {
			name: "Reply",
			exact: true,
		});
		await replyButton.click();

		const sendButton = article.getByRole("button", { name: "Send" });
		await expect(sendButton).toBeVisible({ timeout: 5_000 });

		const discardButton = page.getByRole("button", { name: "Discard" });
		await discardButton.dispatchEvent("click");

		await expect(
			page.getByRole("button", { name: "Reply", exact: true }),
		).toBeVisible({
			timeout: 10_000,
		});
		await expect(sendButton).toBeHidden();
	});
});
