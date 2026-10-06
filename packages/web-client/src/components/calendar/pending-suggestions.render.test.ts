/**
 * What the mail is still waiting on, beside the calendar (#1277).
 *
 * The column reads `GET /calendar-suggestions?state=Pending` and answers through
 * the same endpoints the card beside a message does, so an answer given here
 * and one given there cannot disagree about what is on the calendar.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapCalendarResponse,
	RemitImapCalendarSuggestionResponse,
} from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "@/test-support/http";
import { PendingSuggestions } from "./PendingSuggestions";

const CALENDAR = "11111111-1111-4111-8111-111111111111";
const SUGGESTION = "22222222-2222-4222-8222-222222222222";

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

const pending: RemitImapCalendarSuggestionResponse = {
	suggestionId: SUGGESTION,
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "uid-1",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state: "Pending",
	summary: "Quarterly review",
	dtStart: "2026-09-01T08:00:00+00:00",
	dtEnd: "2026-09-01T09:00:00+00:00",
	endsAtUtc: "2026-09-01T09:00:00Z",
	allDay: false,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	supersededByMessageId: "",
	supersededByThreadId: "",
	createdAt: 0,
	updatedAt: 0,
	answerOvertakenBy: "None",
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let changedFirst: { suggestionId: string; date: string }[] = [];

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	changedFirst = [];
});

const server = (
	accept: () => Response | undefined,
	reading: RemitImapCalendarSuggestionResponse = pending,
) => {
	let waiting = [reading];
	return (call: HttpCall): unknown => {
		if (call.path.endsWith("/calendars")) return { items: calendars };
		if (call.path.endsWith("/calendar-suggestions")) return { items: waiting };
		if (call.path.endsWith("/accept")) {
			const refusal = accept();
			if (refusal) return refusal;
			waiting = [];
			return { ...pending, state: "Accepted" };
		}
		return { items: [] };
	};
};

const mount = async (respond: (call: HttpCall) => unknown) => {
	http = mockFetch(respond);
	harness = createDomHarness();
	harness.renderApp(
		createElement(PendingSuggestions, {
			onChangeFirst: (suggestionId: string, date: string) =>
				changedFirst.push({ suggestionId, date }),
		}),
	);
	await harness.waitFor(
		() => harness?.text().includes("Quarterly review") === true,
		"the waiting reading to be drawn",
	);
};

describe("what the mail is waiting on, beside the calendar", () => {
	it("asks only for the pending ones", async () => {
		await mount(server(() => undefined));
		const listing = http?.to("/calendar-suggestions") ?? [];
		assert.ok(listing.length > 0);
		assert.match(listing[0].url, /state=Pending/);
	});

	it("adds the top reading to the default calendar and leaves once it is on it", async () => {
		await mount(server(() => undefined));
		harness?.click(harness.byText("button", "Add"));

		await harness?.waitFor(
			() => harness?.text().includes("Quarterly review") === false,
			"the column to leave once nothing waits",
		);
		const accepted =
			http?.to(`/calendar-suggestions/${SUGGESTION}/accept`) ?? [];
		assert.deepEqual(accepted[0]?.body, { calendarId: CALENDAR });
	});

	it("states a refusal instead of leaving a card that did nothing", async () => {
		await mount(server(() => httpError(400, "Already declined.")));
		harness?.click(harness.byText("button", "Add"));

		await harness?.waitFor(
			() => harness?.query('[role="alert"]') !== null,
			"the refusal to be stated",
		);
		assert.match(harness?.text() ?? "", /Couldn't add this to your calendar/);
		assert.match(harness?.text() ?? "", /Quarterly review/);
	});

	it("hands the top reading to the editor on the day it falls", async () => {
		await mount(server(() => undefined));
		harness?.click(harness.byText("button", "Change first"));

		assert.deepEqual(changedFirst, [
			{ suggestionId: SUGGESTION, date: "2026-09-01" },
		]);
		assert.equal(
			http?.to(`/calendar-suggestions/${SUGGESTION}/accept`).length,
			0,
		);
	});

	it("sends a reading nobody could put on a clock to the editor instead of adding it", async () => {
		await mount(
			server(() => undefined, { ...pending, zoneCertainty: "Ambiguous" }),
		);
		harness?.click(harness.byText("button", "Add"));

		assert.deepEqual(
			changedFirst.map((entry) => entry.suggestionId),
			[SUGGESTION],
		);
		assert.equal(
			http?.to(`/calendar-suggestions/${SUGGESTION}/accept`).length,
			0,
		);
		assert.match(harness?.text() ?? "", /Quarterly review/);
	});

	it("applies a cancellation nobody could put on a clock, and offers no editor for it", async () => {
		await mount(
			server(() => undefined, {
				...pending,
				method: "Cancel",
				zoneCertainty: "Ambiguous",
			}),
		);
		assert.equal(
			harness
				?.queryAll("button")
				.some((button) => button.textContent?.includes("Change first")),
			false,
		);

		harness?.click(harness.byText("button", "Add"));
		await harness?.waitFor(
			() =>
				(http?.to(`/calendar-suggestions/${SUGGESTION}/accept`).length ?? 0) >
				0,
			"the cancellation to be applied",
		);
		assert.deepEqual(changedFirst, []);
	});
});
