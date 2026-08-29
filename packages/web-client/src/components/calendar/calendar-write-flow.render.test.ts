/**
 * Writing an event and deleting one, through the addresses that carry them.
 *
 * The addresses are the real ones — `/calendar/{view}/{date}/new` and the event
 * segment under the view — and so are the components each mounts. What is
 * asserted is the request that left and the address the reader ends up at,
 * because a form that posts and then leaves the composer up looks exactly like
 * one that posted nothing.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapCalendarEventInstance,
	RemitImapCalendarEventResponse,
	RemitImapCalendarResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	type RouteComponent,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { CalendarComposeSeedProvider } from "@/components/calendar/CalendarComposeSeed";
import { calendarSearchSchema } from "@/lib/calendar-route";
import { stringifySearch } from "@/lib/search-params";
import { Route as OccurrenceRoute } from "../../routes/calendar/$view.$date/$calendarObjectId/$recurrenceId.js";
import { Route as EventIndexRoute } from "../../routes/calendar/$view.$date/$calendarObjectId/index.js";
import { Route as EventRoute } from "../../routes/calendar/$view.$date/$calendarObjectId.js";
import { Route as ComposeRoute } from "../../routes/calendar/$view.$date/new.js";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../test-support/http";

// The router reads `self` at construction; the shared globals stop at `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const WORK = "11111111-1111-4111-8111-111111111111";
const OBJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WEEK = "/calendar/week/2026-06-10";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

/**
 * The component a file route mounts, lifted off the route itself.
 *
 * The route objects are module singletons and re-parenting one mutates it for
 * every other test in the process, so the tree below is built fresh per case
 * out of the real components rather than out of the real routes. Which routes
 * an address mounts is `routes/calendar/-calendar-tree.test.ts`'s subject; this
 * one is about what those components then do.
 */
const componentOf = (route: unknown): RouteComponent => {
	const { component } = (route as { options: { component?: RouteComponent } })
		.options;
	if (!component) throw new Error("the route mounts no component");
	return component;
};

const calendars: RemitImapCalendarResponse[] = [
	{
		calendarId: WORK,
		accountConfigId: "cfg-1",
		urlSegment: "work",
		displayName: "Work",
		color: "Cal1",
		componentSet: "VeventOnly",
		source: "UserCreated",
		timezone: "Europe/Amsterdam",
		syncSequence: 1,
		createdAt: 0,
		updatedAt: 0,
	} as RemitImapCalendarResponse,
];

const instance: RemitImapCalendarEventInstance = {
	calendarId: WORK,
	calendarObjectId: OBJECT,
	recurrenceId: "",
	icalUid: "uid-1",
	summary: "Roadmap review",
	start: "2026-06-10T10:00:00+02:00",
	end: "2026-06-10T11:30:00+02:00",
	allDay: false,
	status: "Confirmed",
	transparency: "Opaque",
	zoneCertainty: "Explicit",
	etag: "etag-1",
	hasRecurrence: false,
} as RemitImapCalendarEventInstance;

const resource = {
	calendarObjectId: OBJECT,
	calendarId: WORK,
	resourceName: "roadmap.ics",
	icalUid: "uid-1",
	icalData: [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"SUMMARY:Roadmap review",
		"LOCATION:Room Zuid",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n"),
	etag: "etag-1",
} as RemitImapCalendarEventResponse;

/**
 * The calendar's addresses, at the shape the generated tree gives them: the
 * view, the composer beside the open event, and one occurrence under the series.
 * The grid is left off — nothing here is about how a week is drawn, and the
 * pane routes do not need one mounted beside them to be reached.
 */
const testRouter = (entry: string): AnyRouter => {
	const rootRoute = createRootRoute({ component: Outlet });
	const viewRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/calendar/$view/$date",
		validateSearch: calendarSearchSchema,
		component: () =>
			createElement(
				CalendarComposeSeedProvider,
				{ pick: undefined },
				createElement(Outlet),
			),
	});
	const eventRoute = createRoute({
		getParentRoute: () => viewRoute,
		path: "$calendarObjectId",
		component: componentOf(EventRoute),
	});
	const routeTree = rootRoute.addChildren([
		viewRoute.addChildren([
			createRoute({
				getParentRoute: () => viewRoute,
				path: "new",
				component: componentOf(ComposeRoute),
			}),
			eventRoute.addChildren([
				createRoute({
					getParentRoute: () => eventRoute,
					path: "/",
					component: componentOf(EventIndexRoute),
				}),
				createRoute({
					getParentRoute: () => eventRoute,
					path: "$recurrenceId",
					component: componentOf(OccurrenceRoute),
				}),
			]),
		]),
	]);
	return createRouter({
		routeTree,
		stringifySearch,
		history: createMemoryHistory({ initialEntries: [entry] }),
	}) as unknown as AnyRouter;
};

const mount = async (entry: string, respond: (call: HttpCall) => unknown) => {
	http = mockFetch(respond);
	const router = testRouter(entry);
	await router.load();
	harness = createDomHarness();
	harness.renderApp(createElement(RouterProvider, { router }));
	await settle();
	return router;
};

const settle = async () => {
	await harness?.flush();
	await harness?.wait(30);
	await harness?.flush();
};

const answering =
	(
		respond: (call: HttpCall) => unknown,
		items: RemitImapCalendarEventInstance[] = [instance],
		stored: RemitImapCalendarEventResponse = resource,
	) =>
	(call: HttpCall) => {
		if (call.path.endsWith("/calendars") && call.method === "GET")
			return { items: calendars };
		if (call.path.endsWith("/calendar-events") && call.method === "GET")
			return { items };
		if (call.path.includes("/calendar-events/") && call.method === "GET")
			return stored;
		return respond(call);
	};

const RECURRENCE = "2026-06-10T07:15:00Z";

const occurrence = {
	...instance,
	recurrenceId: RECURRENCE,
	summary: "Standup",
	start: "2026-06-10T09:15:00+02:00",
	end: "2026-06-10T09:30:00+02:00",
	hasRecurrence: true,
} as RemitImapCalendarEventInstance;

const series = {
	...resource,
	icalData: [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"SUMMARY:Standup",
		"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n"),
} as RemitImapCalendarEventResponse;

describe("writing an event from the composer route", () => {
	it("posts what was typed and puts the reader back on the calendar", async () => {
		const router = await mount(
			`${WEEK}/new`,
			answering(() => resource),
		);

		harness?.type(harness.byLabel("Title"), "Supplier call");
		await settle();
		harness?.click(harness.byText("button", "Add"));
		await settle();

		const posted = (http?.calls ?? []).filter(
			(call) =>
				call.method === "POST" && call.path.endsWith("/calendar-events"),
		);
		assert.equal(posted.length, 1, "the event was written once");
		assert.equal(posted[0].body?.summary, "Supplier call");
		assert.equal(posted[0].body?.calendarId, WORK);
		assert.equal(
			router.state.location.pathname,
			WEEK,
			"a saved event closes the composer rather than leaving it up",
		);
	});

	it("says what is missing rather than posting a nameless event", async () => {
		await mount(
			`${WEEK}/new`,
			answering(() => resource),
		);

		harness?.click(harness.byText("button", "Add"));
		await settle();

		assert.equal(
			(http?.calls ?? []).filter((call) => call.method === "POST").length,
			0,
		);
		assert.match(harness?.text() ?? "", /title/i);
	});
});

describe("deleting an event from the event route", () => {
	it("sends the delete with the version on screen and closes the pane", async () => {
		const router = await mount(
			`${WEEK}/${OBJECT}`,
			answering(() => ({})),
		);

		assert.match(harness?.text() ?? "", /Roadmap review/);
		harness?.click(harness.byText("button", "Delete"));
		await settle();

		const deleted = (http?.calls ?? []).filter(
			(call) => call.method === "DELETE",
		);
		assert.equal(deleted.length, 1);
		assert.ok(deleted[0].url.includes(`calendarId=${WORK}`), deleted[0].url);
		assert.equal(
			deleted[0].headers["if-match"],
			"etag-1",
			"a delete built on a version nobody stated can remove somebody else's event",
		);
		assert.equal(router.state.location.pathname, WEEK);
	});
});

describe("editing one morning of a repeating event", () => {
	it("asks what the change applies to before opening the form", async () => {
		await mount(
			`${WEEK}/${OBJECT}/${RECURRENCE}`,
			answering(() => ({}), [occurrence], series),
		);

		assert.doesNotMatch(
			harness?.text() ?? "",
			/What should the change apply to/,
			"the question is asked when Edit is pressed, not before",
		);
		harness?.click(harness.byText("button", "Edit"));
		await settle();

		const asked = harness?.text() ?? "";
		assert.match(asked, /Standup repeats/);
		assert.match(asked, /What should the change apply to/);
		assert.match(
			asked,
			/Every weekday, 09:15/,
			"the rule is read back in words, not as an RRULE",
		);
	});

	it("sends the answer with the edit, naming the occurrence it meant", async () => {
		await mount(
			`${WEEK}/${OBJECT}/${RECURRENCE}`,
			answering(() => ({}), [occurrence], series),
		);

		harness?.click(harness.byText("button", "Edit"));
		await settle();
		harness?.click(harness.byText("button", "This event"));
		await settle();

		harness?.type(harness.byLabel("Title"), "Standup, short");
		await settle();
		harness?.click(harness.byText("button", "Save"));
		await settle();

		const patched = (http?.calls ?? []).filter(
			(call) => call.method === "PATCH",
		);
		assert.equal(patched.length, 1);
		assert.equal(patched[0].body?.summary, "Standup, short");
		assert.equal(
			patched[0].headers["if-match"],
			"etag-1",
			"the write is conditional on the version the form was opened from",
		);
		assert.ok(patched[0].url.includes("scope=This"), patched[0].url);
		assert.ok(
			patched[0].url.includes(encodeURIComponent(RECURRENCE)),
			patched[0].url,
		);
	});
});
