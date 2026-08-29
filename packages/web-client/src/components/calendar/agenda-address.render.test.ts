/**
 * The strip and the address, bound together.
 *
 * Three claims, and every one of them is about the URL rather than about
 * pixels: the strip opens on the day the path names, reaching an end asks for
 * more days rather than replacing the ones on screen, and the day the reader
 * scrolls to is written by `replace` — scrolling is not somewhere they went, so
 * Back belongs to the screen they arrived from and not to every row they
 * passed. The last one is the reason this suite drives the real router instead
 * of a callback: a `push` here would bury the way out under a fortnight of
 * history entries.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	calendarEventOperationsListCalendarEventsQueryKey,
	calendarFreeBusyOperationsListCalendarFreeBusyQueryKey,
	calendarOperationsListCalendarsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import {
	agendaWindow,
	extendRangeEnd,
	extendRangeStart,
	rangeAround,
} from "@/hooks/calendar";
import { useCalendarNavigation } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { calendarSearchSchema } from "../../lib/calendar-route";
import { stringifySearch } from "../../lib/search-params";
import { AgendaView } from "./AgendaView";

const DATE = "2026-06-10";
const WORK = "cal_work";
const HOME = "cal_home";

const TO_WEEK = "to week";

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

/** The zoom switch's own binding, beside the strip the route mounts. */
function CalendarLayout() {
	const { goToView } = useCalendarNavigation();
	return createElement(
		"div",
		null,
		createElement(
			"button",
			{
				type: "button",
				"aria-label": TO_WEEK,
				onClick: () => goToView("week"),
			},
			"Week",
		),
		createElement(AgendaView, {
			density: "comfortable",
			onPickSlot: () => undefined,
		}),
	);
}

const testRouter = (path: string): AnyRouter => {
	const rootRoute = createRootRoute({ component: Outlet });
	const viewRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/calendar/$view/$date",
		validateSearch: calendarSearchSchema,
		component: CalendarLayout,
	});
	// The strip reads whether an event is open, which is a child of this route.
	const eventRoute = createRoute({
		getParentRoute: () => viewRoute,
		path: "$calendarObjectId",
		component: Outlet,
	});
	const instanceRoute = createRoute({
		getParentRoute: () => eventRoute,
		path: "$recurrenceId",
		component: Outlet,
	});
	const composerRoute = createRoute({
		getParentRoute: () => viewRoute,
		path: "new",
		component: Outlet,
	});
	const routeTree = rootRoute.addChildren([
		viewRoute.addChildren([
			eventRoute.addChildren([instanceRoute]),
			composerRoute,
		]),
	]);
	return createRouter({
		routeTree,
		// A list of ticked calendars is repeated params, which is how the app
		// spells one and what a hand-written link says.
		stringifySearch,
		history: createMemoryHistory({ initialEntries: [path] }),
	}) as unknown as AnyRouter;
};

/**
 * Every window the strip can ask for in one case, answered from the cache. A
 * window nobody seeded would fire a real request, and what these cases are
 * about is which windows get asked for, not what comes back.
 */
const seed = (dom: DomHarness) => {
	const opening = rangeAround(DATE);
	const windows = [
		agendaWindow(opening),
		agendaWindow(extendRangeStart(opening)),
		agendaWindow(extendRangeEnd(opening)),
	];
	dom.queryClient.setQueryData(calendarOperationsListCalendarsQueryKey(), {
		items: [],
	});
	for (const window of windows) {
		dom.queryClient.setQueryData(
			calendarEventOperationsListCalendarEventsQueryKey({ query: window }),
			{ items: [] },
		);
		dom.queryClient.setQueryData(
			calendarFreeBusyOperationsListCalendarFreeBusyQueryKey({
				query: window,
			}),
			{ items: [] },
		);
	}
};

interface Mounted {
	dom: DomHarness;
	router: AnyRouter;
	pushes: number;
	replaces: number;
}

const mount = async (path = `/calendar/agenda/${DATE}`): Promise<Mounted> => {
	const dom = createDomHarness();
	harness = dom;
	seed(dom);

	const router = testRouter(path);
	const counted = { pushes: 0, replaces: 0 };
	const { push, replace } = router.history;
	router.history.push = (...args: Parameters<typeof push>) => {
		counted.pushes += 1;
		return push(...args);
	};
	router.history.replace = (...args: Parameters<typeof replace>) => {
		counted.replaces += 1;
		return replace(...args);
	};

	await router.load();
	dom.renderApp(createElement(RouterProvider, { router }));
	await dom.flush();

	return {
		dom,
		router,
		get pushes() {
			return counted.pushes;
		},
		get replaces() {
			return counted.replaces;
		},
	};
};

/** The one element the strip scrolls; jsdom has no layout, only the event. */
const scroller = (dom: DomHarness): Element => {
	const found = dom.query(".overflow-y-auto");
	if (!found) throw new Error("the strip rendered no scroller");
	return found;
};

const scroll = (dom: DomHarness) => {
	dom.dispatch(scroller(dom), new Event("scroll", { bubbles: false }));
};

describe("the day the address names", () => {
	it("is the day the strip opens on", async () => {
		const { dom } = await mount();
		assert.match(dom.text(), /Wednesday/, "the header names another day");
	});

	it("asks only for the days around it, not for the year", async () => {
		const { dom } = await mount();
		const asked = eventWindows(dom);
		assert.equal(asked.length, 1);
		assert.deepEqual(asked[0], agendaWindow(rangeAround(DATE)));
	});
});

describe("reaching an end of the strip", () => {
	it("asks for more days without giving up the ones on screen", async () => {
		const { dom } = await mount();
		const before = dom.text();
		assert.doesNotMatch(before, /17 May/);

		scroll(dom);
		await dom.flush();

		const after = dom.text();
		assert.match(after, /17 May/, "the days before the window did not arrive");
		assert.match(after, /9 Jun/, "the days it opened with were thrown away");
	});

	it("asks for a window it did not already hold", async () => {
		const { dom } = await mount();
		scroll(dom);
		await dom.flush();

		const opening = agendaWindow(rangeAround(DATE));
		assert.ok(
			eventWindows(dom).some((window) => window.from < opening.from),
			"no window reached further back than the one it opened with",
		);
	});
});

describe("the day the reader scrolled to", () => {
	it("is written to the path, so a reload comes back to it", async () => {
		const { dom, router } = await mount();
		scroll(dom);
		await dom.wait(600);
		await dom.flush();

		assert.match(router.state.location.pathname, /^\/calendar\/agenda\//);
		assert.notEqual(
			router.state.location.pathname,
			`/calendar/agenda/${DATE}`,
			"scrolling left the address on the day it opened",
		);
	});

	it("replaces rather than pushes, so Back is still the way out", async () => {
		const mounted = await mount();
		scroll(mounted.dom);
		await mounted.dom.wait(600);
		await mounted.dom.flush();

		assert.ok(mounted.replaces > 0, "the address was never written");
		assert.equal(mounted.pushes, 0, "scrolling stacked up history entries");
	});
});

describe("dropping into the grid and back out", () => {
	it("keeps the day and the calendars the reader was looking at", async () => {
		const { dom, router } = await mount();
		await act(async () => {
			await router.navigate({
				to: "/calendar/$view/$date",
				params: { view: "agenda", date: DATE },
				search: { calendarId: [HOME, WORK] },
			});
		});
		await dom.flush();

		dom.click(dom.byLabel(TO_WEEK));
		await dom.flush();

		assert.equal(router.state.location.pathname, `/calendar/week/${DATE}`);
		assert.deepEqual(router.state.location.search.calendarId, [HOME, WORK]);
	});
});

/** The windows the strip currently has `/calendar-events` open on. */
const eventWindows = (dom: DomHarness): { from: string; to: string }[] =>
	dom.queryClient
		.getQueryCache()
		.getAll()
		.filter((query) => query.isActive())
		.map(
			(query) =>
				query.queryKey[0] as {
					_id?: string;
					query?: { from: string; to: string };
				},
		)
		.filter((key) => key?._id === "calendarEventOperationsListCalendarEvents")
		.flatMap((key) => (key.query ? [key.query] : []));
