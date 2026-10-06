import type { CDPSession, Locator, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { type RunState, readRunState } from "../src/state.js";
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

const TAG = `touch-gestures ${Date.now()}`;
const NEWER = `${TAG} newer`;
const MIDDLE = `${TAG} middle`;
const OLDER = `${TAG} older`;

const htmlMessage = (subject: string, date: Date) => ({
	subject,
	date,
	contentType: "text/html" as const,
	body: `<p style="font-size:18px">${subject}</p><p>Body of ${subject}.</p>`,
});

const fixtureRow = (page: Page, subject: string): Locator =>
	rows(page).filter({ hasText: subject });

const messageIdOf = async (row: Locator): Promise<string> => {
	const id = await row.getAttribute("data-message-id");
	if (!id) throw new Error("row has no message id");
	return id;
};

const openMiddleMessage = async (page: Page): Promise<Locator> => {
	await fixtureRow(page, MIDDLE).tap();
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

});

test.describe("Touch gestures over the message body", () => {
	let run: RunState;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = readRunState();
		api = new ApiClient(run);
		await appendMessages(run.imapUser, [
			htmlMessage(NEWER, new Date("2001-03-01T12:00:00Z")),
			htmlMessage(MIDDLE, new Date("2001-02-01T12:00:00Z")),
			htmlMessage(OLDER, new Date("2001-01-01T12:00:00Z")),
		]);
		await api.triggerSync(run.accountId);
	});

	test.afterAll(async () => {
		for (const mailbox of await api.listMailboxes(run.accountId)) {
			const ids = await api.searchMatchingMessageIds(mailbox.mailboxId, TAG);
			if (ids.length > 0) await api.deleteMessages(ids);
		}
	});

	test.beforeEach(async ({ page }) => {
		await expect(async () => {
			await gotoInbox(page, run.inboxId);
			await expect(fixtureRow(page, MIDDLE)).toHaveCount(1, { timeout: 5_000 });
		}).toPass({ timeout: 90_000 });
	});

	test("a swipe left opens the next message", async ({ page }) => {
		const nextId = await messageIdOf(fixtureRow(page, OLDER));
		const body = await openMiddleMessage(page);
		const at = await centerOf(body);

		await swipe(page, { x: at.x + 120, y: at.y }, { x: at.x - 120, y: at.y });

		await expect.poll(() => page.url()).toContain(nextId);
	});

	test("a swipe right opens the previous message", async ({ page }) => {
		const previousId = await messageIdOf(fixtureRow(page, NEWER));
		const body = await openMiddleMessage(page);
		const at = await centerOf(body);

		await swipe(page, { x: at.x - 120, y: at.y }, { x: at.x + 120, y: at.y });

		await expect.poll(() => page.url()).toContain(previousId);
	});

	test("a pinch zooms the page", async ({ page }) => {
		const body = await openMiddleMessage(page);
		expect(await pageZoom(page)).toBeLessThan(1.01);

		await pinchOut(page, await centerOf(body));

		await expect.poll(() => pageZoom(page)).toBeGreaterThan(1.2);
	});
});
