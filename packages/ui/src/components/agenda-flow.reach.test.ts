/**
 * Who reaches the end of the strip.
 *
 * A sparse diary draws shorter than the distance either end is fetched at, so
 * an end measured off the content alone is reached on the first layout pass and
 * stays reached however many days arrive. That is how a two-event calendar
 * walked its range out to 2032 and took the address with it: every prepend took
 * the scroll offset back, every take-back raised a scroll event, and every
 * scroll event asked for another fortnight at both ends.
 *
 * So reaching an end is something a reader does. The claims here are about who
 * moved the strip — a mount, a resize and a font swap all move it and none of
 * them may fetch — and they are asserted against a stubbed layout, because
 * jsdom has none of its own and the bug lives entirely in the numbers.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildCalendarDay } from "../lib/agenda-time.js";
import { AgendaFlow, type AgendaFlowProps } from "./agenda-flow.js";
import type {
	CalendarDescriptor,
	CalendarEventData,
} from "./calendar-types.js";

const TODAY = "2026-06-10";
const OFFSET = "+02:00";

const dates = [TODAY, "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-3",
	},
];

/** One booking a day, so every day keeps a row of its own to anchor against. */
const event = (date: string): CalendarEventData => ({
	id: `evt_${date}`,
	calendarId: "c1",
	title: `Standup ${date}`,
	start: `${date}T10:00:00${OFFSET}`,
	end: `${date}T10:30:00${OFFSET}`,
	allDay: false,
	location: "",
	notes: "",
	attendees: [],
	myRsvp: "accepted",
	threadId: "",
	threadSubject: "",
	timeZone: "Europe/Amsterdam",
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
});

const days = dates.map((date) => buildCalendarDay(date, [event(date)], TODAY));

let container: HTMLElement;
let root: Root;
let reachedStart: number;
let reachedEnd: number;
let visited: string[];

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	reachedStart = 0;
	reachedEnd = 0;
	visited = [];
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const props = (extra: Partial<AgendaFlowProps> = {}): AgendaFlowProps => ({
	days,
	calendars,
	density: "pills",
	today: TODAY,
	focusDate: TODAY,
	selectedEventId: "",
	onSelectEvent: () => {},
	onPickSlot: () => {},
	onZoomDay: () => {},
	onReachStart: () => {
		reachedStart += 1;
	},
	onReachEnd: () => {
		reachedEnd += 1;
	},
	onVisibleDayChange: (date) => {
		visited.push(date);
	},
	...extra,
});

const render = (extra: Partial<AgendaFlowProps> = {}) => {
	act(() => root.render(createElement(AgendaFlow, props(extra))));
};

/**
 * jsdom has no layout, so the strip is given one. `scrollTop` clamps the way a
 * browser's does, which is what makes a pane taller than its content — the
 * whole of the bug — reproducible here.
 */
interface Strip {
	element: HTMLElement;
	/** The reader's own scroll: a wheel, then the offset it landed at. */
	scroll: (top: number) => void;
	/** The same movement with nobody behind it: a resize, a reflow, a landing. */
	settle: (top: number) => void;
	resize: (size: { scrollHeight: number; clientHeight: number }) => void;
}

const stripWithLayout = (scrollHeight: number, clientHeight: number): Strip => {
	const element = container.querySelector<HTMLElement>(
		'[data-testid="agenda-strip"]',
	);
	assert.ok(element, "the strip mounted");

	const size = { scrollHeight, clientHeight };
	let top = 0;
	Object.defineProperty(element, "scrollHeight", {
		configurable: true,
		get: () => size.scrollHeight,
	});
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		get: () => size.clientHeight,
	});
	Object.defineProperty(element, "scrollTop", {
		configurable: true,
		get: () => top,
		set: (next: number) => {
			top = Math.max(0, Math.min(next, size.scrollHeight - size.clientHeight));
		},
	});
	for (const [index, child] of [...element.children].entries()) {
		Object.defineProperty(child, "offsetTop", {
			configurable: true,
			value: index * 200,
		});
	}

	const raise = () => {
		act(() => {
			element.dispatchEvent(new Event("scroll"));
		});
	};

	return {
		element,
		scroll: (next) => {
			act(() => {
				element.dispatchEvent(new Event("wheel", { bubbles: true }));
			});
			element.scrollTop = next;
			raise();
		},
		settle: (next) => {
			element.scrollTop = next;
			raise();
		},
		resize: (next) => {
			Object.assign(size, next);
			// A pane that shrank around a scroller takes its offset back with it,
			// which is a scroll event nobody asked for.
			const held = top;
			element.scrollTop = held;
			act(() => {
				window.dispatchEvent(new Event("resize"));
			});
			raise();
		},
	};
};

/**
 * Five days with one booking each. The strip stands barely taller than the pane
 * and well inside the distance both ends are fetched at, which is the case the
 * runaway needs: every end is reached, from the first layout pass onwards.
 */
const SPARSE = { scrollHeight: 800, clientHeight: 640 };
/** Enough days that both ends are somewhere the reader has to go to reach. */
const LONG = { scrollHeight: 5_000, clientHeight: 640 };

describe("a strip shorter than the pane holding it", () => {
	it("asks for no days at all when it mounts on the day the address named", () => {
		render();
		const strip = stripWithLayout(SPARSE.scrollHeight, SPARSE.clientHeight);
		strip.settle(0);
		assert.equal(reachedEnd, 0);
		assert.equal(reachedStart, 0);
		assert.deepEqual(visited, []);
	});

	it("asks for none as the layout settles under it", () => {
		render();
		const strip = stripWithLayout(SPARSE.scrollHeight, SPARSE.clientHeight);
		// A font swaps, the rows re-measure, and the landing is re-applied against
		// the height it now has. Every one of these raises a scroll event.
		for (const top of [0, 24, 8, 0]) strip.settle(top);
		assert.equal(reachedEnd, 0);
		assert.equal(reachedStart, 0);
	});

	it("asks for none when the pane is resized around it", () => {
		render();
		const strip = stripWithLayout(SPARSE.scrollHeight, SPARSE.clientHeight);
		strip.settle(120);
		strip.resize({ scrollHeight: 800, clientHeight: 240 });
		strip.resize({ scrollHeight: 800, clientHeight: 900 });
		assert.equal(reachedEnd, 0);
		assert.equal(reachedStart, 0);
	});

	it("leaves the address where it is, having never moved for a reader", () => {
		render();
		const strip = stripWithLayout(SPARSE.scrollHeight, SPARSE.clientHeight);
		strip.settle(120);
		strip.resize({ scrollHeight: 800, clientHeight: 900 });
		assert.deepEqual(visited, []);
	});
});

describe("a reader scrolling the strip", () => {
	it("asks for the days ahead once, on reaching the end", () => {
		render();
		const strip = stripWithLayout(LONG.scrollHeight, LONG.clientHeight);
		strip.scroll(LONG.scrollHeight - LONG.clientHeight);
		assert.equal(reachedEnd, 1);
		assert.equal(reachedStart, 0);
	});

	it("moves the day under the header with them, once", () => {
		render();
		const strip = stripWithLayout(LONG.scrollHeight, LONG.clientHeight);
		strip.scroll(LONG.scrollHeight - LONG.clientHeight);
		assert.equal(visited.length, 1);
		assert.equal(visited[0], dates[dates.length - 1]);
	});

	it("asks again for nothing while it stands still at that end", () => {
		render();
		const strip = stripWithLayout(LONG.scrollHeight, LONG.clientHeight);
		strip.scroll(LONG.scrollHeight - LONG.clientHeight);
		strip.scroll(LONG.scrollHeight - LONG.clientHeight);
		strip.settle(LONG.scrollHeight - LONG.clientHeight);
		assert.equal(reachedEnd, 1);
	});

	it("asks for the days behind only on the way back to the start", () => {
		render();
		const strip = stripWithLayout(LONG.scrollHeight, LONG.clientHeight);
		strip.scroll(LONG.scrollHeight - LONG.clientHeight);
		assert.equal(reachedStart, 0);
		strip.scroll(80);
		assert.equal(reachedStart, 1);
		assert.equal(reachedEnd, 1);
	});
});

describe("the end of what the strip grows to on its own", () => {
	it("says so and offers the next stretch, rather than fetching it", () => {
		let asked = 0;
		render({
			atEndCap: true,
			onLoadLater: () => {
				asked += 1;
			},
		});
		const later = container.querySelector<HTMLElement>(
			'[data-testid="agenda-load-later"]',
		);
		assert.ok(later, "the strip offered the days past the cap");
		assert.match(later.textContent ?? "", /Show later days/);

		act(() => {
			later.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		assert.equal(asked, 1);
	});

	it("offers the days behind the same way", () => {
		render({ atStartCap: true, onLoadEarlier: () => {} });
		const earlier = container.querySelector(
			'[data-testid="agenda-load-earlier"]',
		);
		assert.ok(earlier, "the strip offered the days before the cap");
	});

	it("shows neither while the run still has room to grow", () => {
		render();
		assert.equal(
			container.querySelector('[data-testid^="agenda-load-"]'),
			null,
		);
	});
});
