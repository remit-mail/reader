/**
 * Pointer and touch gestures on the calendar's time grid, in the grid's own
 * coordinates: a day column and a minute past midnight.
 */
import type { Page } from "@playwright/test";

/** Height of one hour at the Detail density, which is the default. */
const HOUR = 48;

export interface Point {
	x: number;
	y: number;
}

/** Scrolls the time grid so the minute shows, and returns the point on the given day there. */
export const slotPoint = async (
	page: Page,
	dayIndex: number,
	minute: number,
	days = 7,
): Promise<Point> => {
	await page.getByRole("grid", { name: "Time grid" }).evaluate(
		(grid, top) => {
			grid.scrollTop = top;
		},
		Math.max(0, (minute / 60) * HOUR - 120),
	);
	const box = await page.locator("[data-time-columns]").boundingBox();
	if (!box) throw new Error("no time grid on screen");
	return {
		x: box.x + box.width * ((dayIndex + 0.5) / days),
		y: box.y + (minute / 60) * HOUR + 2,
	};
};

export const drag = async (
	page: Page,
	from: Point,
	to: Point,
): Promise<void> => {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
};

/** A press and a move of a few slots, released: a dragged range. */
export const dragRange = async (
	page: Page,
	dayIndex: number,
	fromMinute: number,
	toMinute: number,
	days = 7,
): Promise<void> => {
	const start = await slotPoint(page, dayIndex, fromMinute, days);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(
		start.x,
		start.y + ((toMinute - fromMinute) / 60) * HOUR,
		{ steps: 6 },
	);
	await page.mouse.up();
};

/** A press without movement: a click on one slot. */
export const clickSlot = async (
	page: Page,
	dayIndex: number,
	minute: number,
	days = 7,
): Promise<void> => {
	const point = await slotPoint(page, dayIndex, minute, days);
	await page.mouse.click(point.x, point.y);
};

/** A finger held still on a point, then dragged and lifted, through CDP touch events. */
export const holdAndDrag = async (
	page: Page,
	from: Point,
	to: Point,
	holdMs: number,
): Promise<void> => {
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: "touchStart" | "touchMove" | "touchEnd", point: Point) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints:
				type === "touchEnd" ? [] : [{ x: point.x, y: point.y, id: 0 }],
		});
	await touch("touchStart", from);
	await page.waitForTimeout(holdMs);
	const steps = 6;
	for (let step = 1; step <= steps; step += 1) {
		await touch("touchMove", {
			x: from.x + ((to.x - from.x) * step) / steps,
			y: from.y + ((to.y - from.y) * step) / steps,
		});
	}
	await touch("touchEnd", to);
	await cdp.detach();
};
