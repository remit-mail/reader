// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * The calendar's route tree.
 *
 * What is asserted is what the address does rather than what a component
 * renders: which routes a path mounts, which segment carries which fact, and
 * where an address the calendar cannot read is sent instead. The rules are
 * `docs/architecture/url-state.md` — the view and the day are segments (R4/R5),
 * the ticked calendars are query validated by one schema (R7), and no fact
 * appears at two tiers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AnyRoute,
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRouter,
	isRedirect,
	Outlet,
} from "@tanstack/react-router";
import {
	calendarSearchSchema,
	isoDate,
	stepCalendarDate,
} from "@/lib/calendar-route";
import { stringifySearch } from "@/lib/search-params";
import { Route as OccurrenceRoute } from "./$view.$date/$calendarObjectId/$recurrenceId.js";
import { Route as EventIndexRoute } from "./$view.$date/$calendarObjectId/index.js";
import { Route as EventRoute } from "./$view.$date/$calendarObjectId.js";
import { Route as ReadingPaneRoute } from "./$view.$date/index.js";
import { Route as ComposeRoute } from "./$view.$date/new.js";
import { Route as ViewRoute } from "./$view.$date.js";
import { Route as CalendarIndexRoute } from "./index.js";

// The router reads `self` at construction; the shared globals stop at `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

/** The router types a file route's own `update` more narrowly than a test needs. */
type Attachable = { update: (options: unknown) => AnyRoute };
const attach = (route: unknown, options: unknown): AnyRoute =>
	(route as Attachable).update(options);

/**
 * The calendar's routes, mounted the way the generated tree mounts them but
 * without the `/calendar` layout above them — that route only fetches the
 * account list the sidebar is built from, and no rule under test is its. Built
 * once: a file route is a module singleton, and re-parenting one per case would
 * be re-parenting the same object.
 */
const rootRoute = createRootRoute({ component: Outlet });
const viewRoute = attach(ViewRoute, {
	path: "/calendar/$view/$date",
	getParentRoute: () => rootRoute,
});
const eventRoute = attach(EventRoute, {
	path: "$calendarObjectId",
	getParentRoute: () => viewRoute,
});
eventRoute.addChildren([
	attach(EventIndexRoute, { path: "/", getParentRoute: () => eventRoute }),
	attach(OccurrenceRoute, {
		path: "$recurrenceId",
		getParentRoute: () => eventRoute,
	}),
]);
viewRoute.addChildren([
	attach(ReadingPaneRoute, { path: "/", getParentRoute: () => viewRoute }),
	attach(ComposeRoute, { path: "new", getParentRoute: () => viewRoute }),
	eventRoute,
]);
const routeTree = rootRoute.addChildren([
	attach(CalendarIndexRoute, {
		path: "/calendar",
		getParentRoute: () => rootRoute,
	}),
	viewRoute,
]) as unknown as AnyRoute;

interface Match {
	routeIds: string[];
	params: Record<string, string>;
}

/** A router over the tree, spelling its query string the way the app does. */
const routerAt = (entry: string): AnyRouter =>
	createRouter({
		routeTree,
		stringifySearch,
		history: createMemoryHistory({ initialEntries: [entry] }),
	}) as unknown as AnyRouter;

/** The routes an address mounts, deepest last. */
function match(entry: string): Match {
	const router = routerAt(entry);
	const matches = router.matchRoutes(router.state.location);
	return {
		routeIds: matches.map((one: { routeId: string }) => one.routeId),
		params: matches[matches.length - 1].params as Record<string, string>,
	};
}

interface SentTo {
	to?: string;
	params?: Record<string, string>;
	search?: Record<string, unknown>;
}

const beforeLoadOf = (route: unknown): ((args: unknown) => void) => {
	const { beforeLoad } = (
		route as { options: { beforeLoad?: (args: unknown) => void } }
	).options;
	assert.ok(beforeLoad, "the route decides nothing about the address it got");
	return beforeLoad;
};

type Address = { params: Record<string, string>; search: unknown };

/** Where a route sends an address it will not serve. */
function sentTo(route: unknown, address: Address): SentTo {
	let sent: SentTo | undefined;
	assert.throws(
		() => beforeLoadOf(route)(address),
		(thrown: unknown) => {
			assert.ok(isRedirect(thrown), `not a redirect: ${String(thrown)}`);
			sent = (thrown as { options: SentTo }).options;
			return true;
		},
	);
	return sent as SentTo;
}

/** That the route serves the address as it stands, rewriting nothing. */
function serves(route: unknown, address: Address): void {
	assert.doesNotThrow(() => beforeLoadOf(route)(address));
}

const TODAY = isoDate(new Date());
const held = (view: string, date: string) => ({
	params: { view, date },
	search: {},
});

describe("/calendar", () => {
	it("sends a link that names no zoom to this week", () => {
		const sent = sentTo(CalendarIndexRoute, { params: {}, search: {} });
		assert.equal(sent.to, "/calendar/$view/$date");
		assert.deepEqual(sent.params, { view: "week", date: TODAY });
	});

	it("takes whatever the link ticked off with it", () => {
		const sent = sentTo(CalendarIndexRoute, {
			params: {},
			search: { calendarId: ["cal_a"] },
		});
		assert.deepEqual(sent.search, { calendarId: ["cal_a"] });
	});
});

describe("/calendar/{view}/{date}", () => {
	it("serves every zoom the ladder has, on the day named", () => {
		for (const view of ["year", "month", "week", "day", "agenda"]) {
			serves(ViewRoute, held(view, "2026-06-10"));
			const mounted = match(`/calendar/${view}/2026-06-10`);
			assert.ok(mounted.routeIds.includes("/calendar/$view/$date"));
			assert.equal(mounted.params.view, view);
			assert.equal(mounted.params.date, "2026-06-10");
		}
	});

	it("mounts the reading pane under the view with nothing open", () => {
		assert.deepEqual(match("/calendar/week/2026-06-10").routeIds.slice(-2), [
			"/calendar/$view/$date",
			"/calendar/$view/$date/",
		]);
	});

	it("rewrites a zoom the ladder does not have, keeping the day", () => {
		const sent = sentTo(ViewRoute, held("fortnight", "2026-06-10"));
		assert.deepEqual(sent.params, { view: "week", date: "2026-06-10" });
	});

	it("rewrites a day the calendar does not have, keeping the zoom", () => {
		assert.deepEqual(sentTo(ViewRoute, held("day", "2026-02-30")).params, {
			view: "day",
			date: TODAY,
		});
		assert.deepEqual(sentTo(ViewRoute, held("day", "tomorrow")).params, {
			view: "day",
			date: TODAY,
		});
	});
});

describe("the ticked calendars", () => {
	it("are validated by the schema the domain reads them with", () => {
		assert.equal(
			(ViewRoute as unknown as { options: { validateSearch: unknown } }).options
				.validateSearch,
			calendarSearchSchema,
		);
	});

	/**
	 * The address the toolbar's Next writes. Repeated params are the shape the
	 * issue pins and the shape A.3 and C.2 inherit, so what a step writes is
	 * asserted rather than assumed: the router's own serializer would have made
	 * this a JSON blob.
	 */
	it("are written as repeated params when the week steps", () => {
		const router = routerAt("/calendar/week/2026-06-10?calendarId=cal_a");
		const next = router.buildLocation({
			to: "/calendar/$view/$date",
			params: {
				view: "week",
				date: stepCalendarDate("2026-06-10", "week", 1),
			},
			search: { calendarId: ["cal_a", "cal_b"] },
		});
		assert.equal(next.pathname, "/calendar/week/2026-06-17");
		assert.equal(next.searchStr, "?calendarId=cal_a&calendarId=cal_b");
	});

	it("leave the query out of a step that has nothing ticked", () => {
		const router = routerAt("/calendar/week/2026-06-10");
		const next = router.buildLocation({
			to: "/calendar/$view/$date",
			params: { view: "week", date: "2026-06-17" },
			search: {},
		});
		assert.equal(next.searchStr, "");
	});
});

describe("the composer and the open event cannot both be addressed", () => {
	it("mounts the composer, and nothing of the event route", () => {
		const mounted = match("/calendar/week/2026-06-10/new");
		assert.ok(mounted.routeIds.includes("/calendar/$view/$date/new"));
		assert.equal(
			mounted.routeIds.some((id) => id.includes("$calendarObjectId")),
			false,
		);
	});

	it("mounts the event, and nothing of the composer", () => {
		const mounted = match("/calendar/week/2026-06-10/evt_1");
		assert.deepEqual(mounted.routeIds.slice(-2), [
			"/calendar/$view/$date/$calendarObjectId",
			"/calendar/$view/$date/$calendarObjectId/",
		]);
		assert.equal(mounted.params.calendarObjectId, "evt_1");
		assert.equal(mounted.routeIds.includes("/calendar/$view/$date/new"), false);
	});

	it("keeps the series matched under one of its occurrences", () => {
		const mounted = match(
			"/calendar/week/2026-06-10/evt_1/2026-06-11T09%3A15%3A00%2B02%3A00",
		);
		assert.deepEqual(mounted.routeIds.slice(-2), [
			"/calendar/$view/$date/$calendarObjectId",
			"/calendar/$view/$date/$calendarObjectId/$recurrenceId",
		]);
		assert.equal(mounted.params.calendarObjectId, "evt_1");
		assert.equal(mounted.params.recurrenceId, "2026-06-11T09:15:00+02:00");
	});
});
