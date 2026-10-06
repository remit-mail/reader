/**
 * Touch gestures on the phone layout (#1362), driven as a finger and not as a
 * mouse: the context has touch support, and every hold, swipe and pinch goes
 * through Chromium's trusted touch input (`Input.dispatchTouchEvent` and
 * `Input.synthesizePinchGesture`), so the pointers the app sees report
 * `pointerType: "touch"`.
 */
import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const MOBILE = { width: 390, height: 844 };
test.use({ viewport: MOBILE, hasTouch: true, isMobile: true });

const rows = (page: Page): Locator => page.locator("[data-message-row]");

interface Point {
	x: number;
	y: number;
}

const centerOf = async (locator: Locator): Promise<Point> => {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no bounding box to touch");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const touchEvent = (
	cdp: CDPSession,
	type: "touchStart" | "touchMove" | "touchEnd",
	point?: Point,
): Promise<unknown> =>
	cdp.send("Input.dispatchTouchEvent", {
		type,
		touchPoints: point ? [{ x: point.x, y: point.y, id: 0 }] : [],
	});

const hold = async (page: Page, at: Point, holdMs: number): Promise<void> => {
	const cdp = await page.context().newCDPSession(page);
	await touchEvent(cdp, "touchStart", at);
	await page.waitForTimeout(holdMs);
	await touchEvent(cdp, "touchEnd");
};

const swipe = async (page: Page, from: Point, to: Point): Promise<void> => {
	const cdp = await page.context().newCDPSession(page);
	const steps = 8;
	await touchEvent(cdp, "touchStart", from);
	for (let step = 1; step <= steps; step++) {
		await touchEvent(cdp, "touchMove", {
			x: from.x + ((to.x - from.x) * step) / steps,
			y: from.y + ((to.y - from.y) * step) / steps,
		});
		await page.waitForTimeout(8);
	}
	await touchEvent(cdp, "touchEnd");
};

const pinchOut = async (page: Page, at: Point): Promise<void> => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Input.synthesizePinchGesture", {
		x: at.x,
		y: at.y,
		scaleFactor: 2.5,
		relativeSpeed: 400,
		gestureSourceType: "touch",
	});
};

const pageZoom = (page: Page): Promise<number> =>
	page.evaluate(() => window.visualViewport?.scale ?? 1);

const gotoInbox = async (page: Page, mailboxId: string): Promise<void> => {
	await page.goto(`/mail/${mailboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

const selectionStatus = (page: Page): Locator =>
	page.locator("[data-selection-count]");

const openSecondMessage = async (page: Page): Promise<Locator> => {
	await rows(page).nth(1).tap();
	await page.waitForURL(MAILBOX_THREAD_URL);
	const body = page.locator('iframe[title="Email content"]').first();
	await expect(body).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(async () => (await body.boundingBox())?.height ?? 0)
		.toBeGreaterThan(40);
	return body;
};

test.describe("Touch gestures", () => {
	test.beforeEach(async ({ page, run }) => {
		await gotoInbox(page, run.inboxId);
	});

	test("a tap opens the message", async ({ page }) => {
		await rows(page).first().tap();
		await page.waitForURL(MAILBOX_THREAD_URL);
	});

	test("a held press enters selection mode", async ({ page }) => {
		await hold(page, await centerOf(rows(page).first()), 700);

		await expect(selectionStatus(page)).toHaveText("1 message selected");
	});

	test("a press that is released early does not select", async ({ page }) => {
		await hold(page, await centerOf(rows(page).first()), 100);

		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(selectionStatus(page)).toHaveCount(0);
	});

	test("a swipe left on a row reveals its delete action", async ({ page }) => {
		const from = await centerOf(rows(page).first());

		await swipe(page, from, { x: from.x - 160, y: from.y });

		await expect(
			page.getByRole("button", { name: "Delete message" }),
		).toBeVisible();
		await expect(selectionStatus(page)).toHaveCount(0);
	});

	test("a swipe right on a row reveals its read toggle", async ({ page }) => {
		const from = await centerOf(rows(page).first());

		await swipe(page, from, { x: from.x + 160, y: from.y });

		await expect(
			page.getByRole("button", { name: /^Mark as (read|unread)$/ }),
		).toBeVisible();
	});

	test("a swipe left over the message body opens the next message", async ({
		page,
	}) => {
		const body = await openSecondMessage(page);
		const opened = page.url();
		const at = await centerOf(body);

		await swipe(page, { x: at.x + 120, y: at.y }, { x: at.x - 120, y: at.y });

		await expect.poll(() => page.url()).not.toBe(opened);
	});

	test("a swipe right over the message body opens the previous message", async ({
		page,
	}) => {
		const body = await openSecondMessage(page);
		const opened = page.url();
		const at = await centerOf(body);

		await swipe(page, { x: at.x - 120, y: at.y }, { x: at.x + 120, y: at.y });

		await expect.poll(() => page.url()).not.toBe(opened);
	});

	test("a pinch over the message body zooms the page", async ({ page }) => {
		const body = await openSecondMessage(page);
		expect(await pageZoom(page)).toBeLessThan(1.01);

		await pinchOut(page, await centerOf(body));

		await expect.poll(() => pageZoom(page)).toBeGreaterThan(1.2);
	});
});
