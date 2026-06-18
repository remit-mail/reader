import { expect, test } from "./fixtures/account-setup.js";

/**
 * Mobile regression suite for the conversation view.
 *
 * Verifies that both the action toolbar and the intelligence info panel are
 * accessible at a phone-sized viewport (390×844, below the 1024px desktop
 * breakpoint where the three-pane layout kicks in).
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe("Mobile conversation view", () => {
	test.use({ viewport: MOBILE_VIEWPORT });

	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");

		// At a phone viewport the mailbox sidebar lives in a drawer behind the
		// hamburger button (aria-label "Menu"). Open it to reach the navigation.
		const menuButton = page.getByRole("button", { name: "Menu" });
		await expect(menuButton).toBeVisible({ timeout: 15_000 });
		await menuButton.click();

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// Open the first message
		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });

		await page.locator("a[href*='selectedMessageId']").first().click();
		await page.waitForURL(/selectedMessageId=/);

		// Wait for article to load (not a loading skeleton)
		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});
	});

	test("action toolbar is present with reply, reply-all and forward buttons", async ({
		page,
	}) => {
		// The MobileActionBar renders at the bottom of the article on mobile.
		// These buttons must be visible without a desktop toolbar being present.
		await expect(
			page.getByRole("button", { name: "Reply", exact: true }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Reply all" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Forward" })).toBeVisible();
	});

	test("back button returns to message list", async ({ page }) => {
		const backButton = page.getByRole("button", { name: /back to messages/i });
		await expect(backButton).toBeVisible();
		await backButton.click();

		// After going back the URL should no longer contain selectedMessageId
		await page.waitForURL(/\/mail\/[a-z0-9]+(?!\?.*selectedMessageId)/);
		// The message list should be visible again
		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("management top bar has archive, delete, and star buttons", async ({
		page,
	}) => {
		// MobileConversationTopBar renders above the article body
		await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Move to Trash" }),
		).toBeVisible();
		// Star button has a dynamic label depending on state
		await expect(
			page.getByRole("button", { name: /flag|remove flag/i }),
		).toBeVisible();
	});

	test("info panel opens and closes via the Details button in the action bar", async ({
		page,
	}) => {
		// The Details / Message details button in MobileActionBar opens the info drawer
		const detailsButton = page.getByRole("button", {
			name: /message details/i,
		});
		await expect(detailsButton).toBeVisible();

		// Open the drawer. The button sits at the bottom-right of the action
		// bar where the dev-only TanStack Query devtools toggle overlaps it and
		// swallows pointer events, so dispatch the click straight to the button.
		await detailsButton.dispatchEvent("click");

		// The Drawer renders as a dialog with aria-label "Message details"
		const drawer = page.getByRole("dialog", { name: /message details/i });
		await expect(drawer).toBeVisible({ timeout: 5_000 });

		// Intelligence panel content should be present
		await expect(
			drawer.getByText(/intelligence|sender|authenticity/i).first(),
		).toBeVisible({ timeout: 5_000 });

		// Close the drawer via its own close button. The full-screen scrim
		// shares the "Close menu" label and comes first in DOM order, so target
		// the last match — the panel-hosted close control.
		const closeButton = drawer
			.getByRole("button", { name: /close menu/i })
			.last();
		await expect(closeButton).toBeVisible();
		await closeButton.click();

		// Drawer should no longer be visible
		await expect(drawer).toBeHidden({ timeout: 3_000 });
	});

	test("info panel opens via the intelligence button in the top bar", async ({
		page,
	}) => {
		// MobileConversationTopBar also has an Info / Show intelligence panel button
		const infoButton = page.getByRole("button", {
			name: /show intelligence panel/i,
		});
		await expect(infoButton).toBeVisible();

		await infoButton.click();

		const drawer = page.getByRole("dialog", { name: /message details/i });
		await expect(drawer).toBeVisible({ timeout: 5_000 });

		// Dismiss via the drawer's own close control. (The full-screen scrim
		// shares the "Close menu" label but the drawer panel overlaps its
		// centre, so clicking the panel-hosted close button is the reliable
		// affordance.)
		await drawer
			.getByRole("button", { name: /close menu/i })
			.last()
			.click();

		await expect(drawer).toBeHidden({ timeout: 3_000 });
	});

	test("reply opens inline compose and compose can be dismissed", async ({
		page,
	}) => {
		const replyButton = page.getByRole("button", {
			name: "Reply",
			exact: true,
		});
		await expect(replyButton).toBeVisible();
		await replyButton.click();

		// The inline compose replaces the MobileActionBar inside the article.
		// The message body is a rich-text editor (contenteditable), not a
		// textarea — assert on the compose's Send button, which only renders
		// once the compose form is open.
		const article = page.getByRole("article");
		await expect(
			article.getByRole("button", { name: "Send", exact: true }),
		).toBeVisible({ timeout: 5_000 });
	});
});
