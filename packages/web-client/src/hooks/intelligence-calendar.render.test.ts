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
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "@/test-support/http";
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

const mount = async (respond: (call: HttpCall) => unknown) => {
	http = mockFetch(respond);
	harness = createDomHarness();
	harness.renderApp(createElement(Harness));
	await harness.waitFor(
		() => harness?.text().includes("Quarterly review") === true,
		"the invitation to be drawn",
	);
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

	it("offers the picked times to select by hand where the page has no clipboard", async () => {
		await mount(server(() => "Accepted"));
		Object.defineProperty(navigator, "clipboard", {
			value: undefined,
			configurable: true,
		});
		press("Offer other times");
		const slot = harness?.query("[aria-pressed]");
		if (!slot) throw new Error("no slot offered");
		harness?.click(slot);
		press("Copy picked times");

		await harness?.waitFor(
			() => harness?.query('textarea[aria-label="Picked times"]') !== null,
			"the times to be offered for selecting",
		);
		assert.match(harness?.text() ?? "", /can't copy for you/);
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
