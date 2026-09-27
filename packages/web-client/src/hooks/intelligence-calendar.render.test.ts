/**
 * The invitation beside the open message, answered through the API (#1277).
 *
 * Drives the real chain: `useIntelligenceCalendar` reads the message's
 * suggestions and the calendars, the real `IntelligencePanel` draws the card,
 * and a press sends the request the server acts on. What is asserted is the
 * request that left and what the card says after the server answered — a card
 * that moves on its own before the answer is the thing this rules out.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapCalendarResponse,
	RemitImapCalendarSuggestionResponse,
} from "@remit/api-http-client/types.gen.ts";
import { type IntelligenceData, IntelligencePanel } from "@remit/ui";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "@/test-support/http";
import { threadRouter } from "@/test-support/thread-router";
import { useIntelligenceCalendar } from "./useIntelligenceCalendar";

const CALENDAR = "11111111-1111-4111-8111-111111111111";
const SUGGESTION = "22222222-2222-4222-8222-222222222222";

const thread = makeThreadMessage({ messageId: "msg-1" });

const sender: IntelligenceData = {
	sender: {
		name: "Organizer",
		email: "organizer@example.test",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.test",
		summary: "Signed by example.test.",
	},
	category: { value: "personal" },
	similar: [],
};

const calendars = [
	{
		calendarId: CALENDAR,
		accountConfigId: "cfg-1",
		urlSegment: "default",
		displayName: "Personal",
		color: "Cal2",
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

const invitation = (
	state: RemitImapCalendarSuggestionResponse["state"],
): RemitImapCalendarSuggestionResponse => ({
	suggestionId: SUGGESTION,
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "uid-1",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state,
	summary: "Quarterly review",
	dtStart: "2026-09-01T08:00:00+00:00",
	dtEnd: "2026-09-01T09:00:00+00:00",
	allDay: false,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	supersededByMessageId: "",
	supersededByThreadId: "",
	createdAt: 0,
	updatedAt: 0,
});

const Harness = () => {
	const calendar = useIntelligenceCalendar(thread);
	return createElement(IntelligencePanel, {
		data: sender,
		calendar: calendar.surface,
		tab: calendar.tab,
		onTabChange: calendar.onTabChange,
	});
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

/**
 * A server holding one pending invitation. `answer` decides what an answer
 * does: the state it moves the suggestion to, or a refusal to send back.
 */
const server = (
	answer: (
		call: HttpCall,
	) => RemitImapCalendarSuggestionResponse["state"] | Response,
) => {
	let state: RemitImapCalendarSuggestionResponse["state"] = "Pending";
	return (call: HttpCall): unknown => {
		if (call.path.endsWith("/calendars")) return { items: calendars };
		if (call.path.endsWith("/messages/msg-1/calendar-suggestions"))
			return { items: [invitation(state)] };
		if (
			call.method === "POST" &&
			call.path.includes("/calendar-suggestions/")
		) {
			const next = answer(call);
			if (next instanceof Response) return next;
			state = next;
			return invitation(state);
		}
		return { items: [] };
	};
};

const mount = async (
	respond: (call: HttpCall) => unknown,
): Promise<AnyRouter> => {
	http = mockFetch(respond);
	harness = createDomHarness();
	const router = threadRouter(Harness, "/mail/brief/thread-1/msg-1");
	await router.load();
	harness.renderApp(createElement(RouterProvider, { router }));
	await harness.waitFor(
		() => harness?.text().includes("Quarterly review") === true,
		"the invitation to be drawn",
	);
	return router;
};

const press = (label: string) => {
	if (!harness) throw new Error("not mounted");
	harness.click(harness.byText("button", label));
};

describe("the invitation beside the open message", () => {
	it("opens on the calendar tab while an invitation waits", async () => {
		await mount(server(() => "Accepted"));
		assert.match(
			harness?.text() ?? "",
			/Invitation from organizer@example\.test/,
		);
		assert.match(harness?.text() ?? "", /Add to calendar/);
	});

	it("adds it to the default calendar, and says so once the server has", async () => {
		await mount(server(() => "Accepted"));
		press("Add to calendar");

		await harness?.waitFor(
			() => harness?.text().includes("On your calendar") === true,
			"the card to read back the accepted state",
		);
		const accepted =
			http?.to(`/calendar-suggestions/${SUGGESTION}/accept`) ?? [];
		assert.equal(accepted.length, 1);
		assert.deepEqual(accepted[0].body, { calendarId: CALENDAR });
	});

	it("states a refused answer where it was pressed, and leaves the button live", async () => {
		await mount(
			server(() => httpError(400, "The calendar it was going into is gone.")),
		);
		press("Add to calendar");

		await harness?.waitFor(
			() =>
				harness?.text().includes("Couldn't add this to your calendar") === true,
			"the refusal to be stated",
		);
		const alert = harness?.query('[role="alert"]');
		assert.ok(alert, "a refusal is an alert, not a quiet line");
		const button = harness?.byText("button", "Add to calendar") as
			| HTMLButtonElement
			| undefined;
		assert.equal(button?.disabled, false);
	});

	it("keeps declining live when the calendars cannot be read, and says why adding waits", async () => {
		const answering = server(() => "Declined");
		await mount((call) =>
			call.path.endsWith("/calendars") ? httpError(500) : answering(call),
		);
		await harness?.waitFor(
			() => harness?.text().includes("Couldn't read your calendars") === true,
			"the calendar read failure to be stated",
		);
		const add = harness?.byText("button", "Add to calendar") as
			| HTMLButtonElement
			| undefined;
		assert.equal(add?.disabled, true);
		assert.ok(harness?.query('a[href*="github.com"]'), "a report link");

		press("Decline");
		await harness?.waitFor(
			() => harness?.text().includes("You declined") === true,
			"the decline to land without a calendar",
		);
	});

	it("declines through the API", async () => {
		await mount(server(() => "Declined"));
		press("Decline");

		await harness?.waitFor(
			() => harness?.text().includes("You declined") === true,
			"the card to read back the declined state",
		);
		assert.equal(
			http?.to(`/calendar-suggestions/${SUGGESTION}/decline`).length,
			1,
		);
	});

	it("names the mail's sender on the mute button, which is who the rule matches", async () => {
		await mount(server(() => "Dismissed"));
		const text = harness?.text() ?? "";
		assert.match(text, /Stop offering invitations from Alice/);
		assert.doesNotMatch(
			text,
			/Stop offering invitations from organizer@example\.test/,
		);
	});

	it("mutes the sender by dismissing with a sender rule, and the tab stays put", async () => {
		await mount(server(() => "Dismissed"));
		press("Stop offering invitations from Alice");

		await harness?.waitFor(
			() => harness?.text().includes("Add to calendar") === false,
			"the card to leave once the server dismissed it",
		);
		assert.match(
			harness?.text() ?? "",
			/Nothing in this message is about a time/,
			"answering the last card keeps the Calendar tab",
		);
		const dismissed =
			http?.to(`/calendar-suggestions/${SUGGESTION}/dismiss`) ?? [];
		assert.equal(dismissed.length, 1);
		assert.deepEqual(dismissed[0].body, { muteSender: true });
	});
});

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const READING = "33333333-3333-4333-8333-333333333333";

const routedMount = async (
	items: RemitImapCalendarSuggestionResponse[],
): Promise<AnyRouter> => {
	http = mockFetch((call: HttpCall): unknown => {
		if (call.path.endsWith("/calendars")) return { items: calendars };
		if (call.path.endsWith("/messages/msg-1/calendar-suggestions"))
			return { items };
		return { items: [] };
	});
	const rootRoute = createRootRoute({ component: Harness });
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/mail",
			component: () => null,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/calendar/$view/$date/suggestion/$suggestionId",
			component: () => null,
		}),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/mail"] }),
	}) as unknown as AnyRouter;
	await router.load();
	harness = createDomHarness();
	harness.renderApp(createElement(RouterProvider, { router }));
	await harness.waitFor(
		() => harness?.text().includes("Quarterly review") === true,
		"the invitation to be drawn",
	);
	return router;
};

const answered = (): HttpCall[] =>
	(http?.calls ?? []).filter((call) => call.method === "POST");

describe("changing a suggestion beside the message before adding it", () => {
	it("opens the editor for a reading from the thread on the day it falls", async () => {
		const router = await routedMount([
			invitation("Pending"),
			{
				...invitation("Pending"),
				suggestionId: READING,
				source: "TextHeuristic",
				summary: "Lunch with Sam",
			},
		]);
		await harness?.waitFor(
			() => harness?.text().includes("Lunch with Sam") === true,
			"the reading to be drawn",
		);

		press("Change first");
		await harness?.waitFor(
			() => router.state.location.pathname.includes(READING),
			"the editor to be opened",
		);

		assert.equal(
			router.state.location.pathname,
			`/calendar/day/2026-09-01/suggestion/${READING}`,
		);
		assert.deepEqual(answered(), []);
	});

	it("sends an invitation nobody could put on a clock to the editor instead of adding it", async () => {
		const router = await routedMount([
			{ ...invitation("Pending"), zoneCertainty: "Ambiguous" },
		]);

		press("Add to calendar");
		await harness?.waitFor(
			() => router.state.location.pathname.includes(SUGGESTION),
			"the editor to be opened",
		);

		assert.equal(
			router.state.location.pathname,
			`/calendar/day/2026-09-01/suggestion/${SUGGESTION}`,
		);
		assert.deepEqual(answered(), []);
	});

	it("applies a cancellation read out of the thread, and offers no editor for it", async () => {
		const router = await routedMount([
			invitation("Accepted"),
			{
				...invitation("Pending"),
				suggestionId: READING,
				source: "TextHeuristic",
				method: "Cancel",
				zoneCertainty: "Ambiguous",
				summary: "Lunch with Sam",
			},
		]);
		await harness?.waitFor(
			() => harness?.text().includes("Lunch with Sam") === true,
			"the reading to be drawn",
		);
		const card = harness?.query('article[aria-label="Lunch with Sam"]');
		if (!card) throw new Error("the reading's card is not drawn");
		const buttons = [...card.querySelectorAll("button")];
		assert.equal(
			buttons.some((button) => button.textContent?.includes("Change first")),
			false,
		);
		const add = buttons.find((button) =>
			button.textContent?.includes("Add to calendar"),
		);
		if (!add) throw new Error("the reading offers no Add");
		harness?.click(add);

		await harness?.waitFor(
			() => answered().some((call) => call.path.endsWith(`/${READING}/accept`)),
			"the cancellation to be applied",
		);
		assert.equal(router.state.location.pathname, "/mail");
	});
});

describe("an invitation a newer revision replaced", () => {
	const retired = (
		supersededByThreadId: string,
	): RemitImapCalendarSuggestionResponse => ({
		...invitation("Superseded"),
		supersededByMessageId: "msg-2",
		supersededByThreadId,
	});

	const serving =
		(suggestion: RemitImapCalendarSuggestionResponse) =>
		(call: HttpCall): unknown => {
			if (call.path.endsWith("/calendars")) return { items: calendars };
			if (call.path.endsWith("/messages/msg-1/calendar-suggestions"))
				return { items: [suggestion] };
			return { items: [] };
		};

	it("opens the conversation that carries the newer revision", async () => {
		const router = await mount(serving(retired("thread-2")));
		assert.match(harness?.text() ?? "", /has sent a newer version of this/);

		press("Open the newer invitation");

		await harness?.waitFor(
			() => router.state.location.pathname === "/mail/brief/thread-2/msg-2",
			"the reading pane to move to the newer revision",
		);
	});

	it("offers no way there when the newer message sits in no conversation", async () => {
		await mount(serving(retired("")));

		assert.match(harness?.text() ?? "", /has sent a newer version of this/);
		assert.equal(
			harness
				?.queryAll("button")
				.some((button) =>
					button.textContent?.includes("Open the newer invitation"),
				),
			false,
		);
	});
});
