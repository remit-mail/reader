import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type {
	RemitImapCalendarResponse,
	RemitImapCalendarSuggestionResponse,
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
import { calendarSearchSchema } from "@/lib/calendar-route";
import { stringifySearch } from "@/lib/search-params";
import { Route as SuggestionRoute } from "../../routes/calendar/$view.$date/suggestion.$suggestionId.js";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "../../test-support/http";

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const WORK = "11111111-1111-4111-8111-111111111111";
const SUGGESTION = "22222222-2222-4222-8222-222222222222";
const WEEK = "/calendar/week/2026-06-10";
const ENTRY = `${WEEK}/suggestion/${SUGGESTION}`;

const calendars = [
	{
		calendarId: WORK,
		accountConfigId: "cfg-1",
		urlSegment: "work",
		displayName: "Work",
		color: "Cal1",
		componentSet: "VeventOnly",
		source: "Default",
		timezone: "Europe/Amsterdam",
		syncSequence: 1,
		subscriptionUrl: "",
		subscriptionEnabled: false,
		subscriptionCheckedAt: 0,
		subscriptionFetchedAt: 0,
		subscriptionError: "",
		createdAt: 0,
		updatedAt: 0,
	},
] satisfies RemitImapCalendarResponse[];

const reading = (
	overrides: Partial<RemitImapCalendarSuggestionResponse> = {},
): RemitImapCalendarSuggestionResponse => ({
	suggestionId: SUGGESTION,
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "uid-1",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state: "Pending",
	summary: "Billing migration kickoff",
	dtStart: "2026-06-11T12:00:00+00:00",
	dtEnd: "2026-06-11T13:00:00+00:00",
	endsAtUtc: "2026-06-11T13:00:00Z",
	allDay: false,
	location: "Room Noord",
	organizer: "priya@example.test",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	supersededByMessageId: "",
	supersededByThreadId: "",
	createdAt: 0,
	updatedAt: 0,
	answerOvertakenBy: "None",
	...overrides,
});

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
const runnerZone = process.env.TZ;

before(() => {
	process.env.TZ = "Europe/Amsterdam";
});

after(() => {
	if (runnerZone === undefined) Reflect.deleteProperty(process.env, "TZ");
	else process.env.TZ = runnerZone;
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const componentOf = (route: unknown): RouteComponent => {
	const { component } = (route as { options: { component?: RouteComponent } })
		.options;
	if (!component) throw new Error("the route mounts no component");
	return component;
};

const testRouter = (): AnyRouter => {
	const rootRoute = createRootRoute({ component: Outlet });
	const viewRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/calendar/$view/$date",
		validateSearch: calendarSearchSchema,
		component: Outlet,
	});
	const routeTree = rootRoute.addChildren([
		viewRoute.addChildren([
			createRoute({
				getParentRoute: () => viewRoute,
				path: "/",
				component: () => null,
			}),
			createRoute({
				getParentRoute: () => viewRoute,
				path: "suggestion/$suggestionId",
				component: componentOf(SuggestionRoute),
			}),
		]),
	]);
	return createRouter({
		routeTree,
		stringifySearch,
		history: createMemoryHistory({ initialEntries: [ENTRY] }),
	}) as unknown as AnyRouter;
};

const server = (
	suggestion: RemitImapCalendarSuggestionResponse,
	answer: (call: HttpCall) => Response | undefined = () => undefined,
) => {
	let pending = [suggestion];
	return (call: HttpCall): unknown => {
		if (call.path.endsWith("/calendars")) return { items: calendars };
		if (call.path.endsWith("/calendar-suggestions")) return { items: pending };
		if (call.path.endsWith("/accept")) {
			const refusal = answer(call);
			if (refusal) return refusal;
			pending = [];
			return { ...suggestion, state: "Accepted" };
		}
		return { items: [] };
	};
};

const mount = async (respond: (call: HttpCall) => unknown) => {
	http = mockFetch(respond);
	const router = testRouter();
	await router.load();
	harness = createDomHarness();
	harness.renderApp(createElement(RouterProvider, { router }));
	await harness.waitFor(
		() =>
			(harness?.queryAll<HTMLInputElement>("input") ?? []).some(
				(input) => input.value === "Billing migration kickoff",
			),
		"the editor to open seeded from the suggestion",
	);
	await harness.waitFor(
		() => harness?.query("input[type=radio]:checked") !== null,
		"the default calendar to be picked",
	);
	return router;
};

const fieldValue = (label: string): string => {
	if (!harness) throw new Error("not mounted");
	return (harness.byLabel(label) as HTMLInputElement).value;
};

const acceptedEdits = (): HttpCall[] =>
	http?.to(`/calendar-suggestions/${SUGGESTION}/accept`) ?? [];

describe("changing a suggestion before adding it", () => {
	it("opens the editor on what the mail said, on this device's clock", async () => {
		await mount(server(reading()));

		assert.equal(fieldValue("Title"), "Billing migration kickoff");
		assert.equal(fieldValue("Location"), "Room Noord");
		assert.equal(fieldValue("Date"), "2026-06-11");
		assert.equal(fieldValue("Start time"), "14:00");
		assert.equal(fieldValue("End time"), "15:00");
	});

	it("adds the corrected event, settles the suggestion and closes the editor", async () => {
		const router = await mount(server(reading()));

		harness?.type(harness.byLabel("Title"), "Billing migration kickoff, moved");
		harness?.type(harness.byLabel("Start time"), "16:00");
		harness?.type(harness.byLabel("End time"), "17:30");
		await harness?.flush();
		harness?.click(harness.byText("button", "Add"));

		await harness?.waitFor(
			() => router.state.location.pathname === WEEK,
			"the editor to close once the server settled the suggestion",
		);
		const sent = acceptedEdits();
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0].body, {
			calendarId: WORK,
			event: {
				summary: "Billing migration kickoff, moved",
				start: "2026-06-11T16:00:00+02:00",
				end: "2026-06-11T17:30:00+02:00",
				allDay: false,
				timeZone: "Europe/Amsterdam",
			},
		});
		const listings = http?.to("/calendar-suggestions") ?? [];
		assert.ok(
			listings.length > 1,
			"the waiting list is read again once the suggestion is settled",
		);
	});

	it("places a reading nobody could put on a clock, even when the time is left alone", async () => {
		await mount(
			server(
				reading({
					dtStart: "2026-06-11T09:00:00+00:00",
					dtEnd: "2026-06-11T10:00:00+00:00",
					endsAtUtc: "2026-06-11T10:00:00Z",
					zoneCertainty: "Ambiguous",
				}),
			),
		);

		assert.equal(fieldValue("Start time"), "09:00");
		assert.match(harness?.text() ?? "", /time zone nothing could resolve/);
		harness?.click(harness.byText("button", "Add"));
		await harness?.waitFor(
			() => acceptedEdits().length === 1,
			"the correction to be sent",
		);

		assert.deepEqual(acceptedEdits()[0].body?.event, {
			start: "2026-06-11T09:00:00+02:00",
			end: "2026-06-11T10:00:00+02:00",
			allDay: false,
			timeZone: "Europe/Amsterdam",
		});
	});

	it("states a refusal and keeps the editor open with what was typed", async () => {
		const router = await mount(
			server(reading(), () => httpError(400, "Already declined.")),
		);

		harness?.type(harness.byLabel("Title"), "Kickoff, renamed");
		await harness?.flush();
		harness?.click(harness.byText("button", "Add"));

		await harness?.waitFor(
			() => harness?.query('[role="alert"]') !== null,
			"the refusal to be stated",
		);
		assert.match(harness?.text() ?? "", /Couldn't add this to your calendar/);
		assert.equal(fieldValue("Title"), "Kickoff, renamed");
		assert.equal(router.state.location.pathname, ENTRY);
	});

	it("finds a suggestion that is not on the first page of what waits", async () => {
		http = mockFetch((call: HttpCall): unknown => {
			if (call.path.endsWith("/calendars")) return { items: calendars };
			if (call.path.endsWith("/calendar-suggestions"))
				return call.url.includes("continuationToken=page-2")
					? { items: [reading()] }
					: {
							items: [{ ...reading(), suggestionId: "other" }],
							continuationToken: "page-2",
						};
			return { items: [] };
		});
		const router = testRouter();
		await router.load();
		harness = createDomHarness();
		harness.renderApp(createElement(RouterProvider, { router }));

		await harness.waitFor(
			() =>
				harness
					?.queryAll<HTMLInputElement>("input")
					.some((input) => input.value === "Billing migration kickoff") ===
				true,
			"the editor to open on the suggestion from the second page",
		);
		assert.doesNotMatch(harness.text(), /no longer waiting/);
	});
});
