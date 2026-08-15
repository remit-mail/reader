import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { EventSuggestion } from "./calendar-types.js";
import { EventSuggestionCard } from "./event-suggestion-card.js";

const suggestion: EventSuggestion = {
	id: "s1",
	title: "Stay in Lisbon",
	start: "2026-06-19",
	end: "2026-06-23",
	allDay: true,
	location: "Alfama, Lisbon",
	threadId: "thr_airbnb",
	threadSubject: "Your reservation in Lisbon is confirmed",
	sender: "Airbnb",
	senderAddress: "automated@airbnb.example",
	confidence: 0.94,
	ambiguity: "",
	suggestedCalendarId: "c5",
	timeZone: "Europe/Lisbon",
	zoneCertainty: "explicit",
};

const render = (overrides: Partial<EventSuggestion>, zoneChoice?: string) =>
	renderToString(
		createElement(EventSuggestionCard, {
			suggestion: { ...suggestion, ...overrides },
			whenText: "Friday 19 June – Monday 22 June",
			zoneChoice,
			onZoneChoice: () => undefined,
			onAdd: () => undefined,
			onReview: () => undefined,
			onDismiss: () => undefined,
			onOpenThread: () => undefined,
		}),
	);

const twoClocks = {
	zoneOptions: [
		{
			timeZone: "Europe/Lisbon",
			label: "16:00 in Lisbon",
			note: "17:00 on your own clock.",
		},
		{
			timeZone: "Europe/Amsterdam",
			label: "16:00 in Amsterdam",
			note: "15:00 where she is.",
		},
	],
};

describe("EventSuggestionCard", () => {
	it("says it is a suggestion and not an event", () => {
		const html = render({});
		assert.match(html, /Suggested from mail/);
		assert.match(html, /border-dashed/);
	});

	it("puts the reading into words rather than a percentage", () => {
		assert.match(render({}), /Read cleanly/);
		assert.match(render({ confidence: 0.7 }), /Read with gaps/);
		assert.match(render({ confidence: 0.2 }), /Barely read/);
	});

	it("names what it could not settle", () => {
		assert.match(
			render({ ambiguity: "Two Tuesdays fit." }),
			/Two Tuesdays fit\./,
		);
	});

	it("credits the mail it was read out of", () => {
		assert.match(render({}), /Airbnb/);
		assert.match(render({}), /Your reservation in Lisbon is confirmed/);
	});

	it("needs a person to press Add", () => {
		assert.match(render({}), />Add</);
	});

	it("asks nothing about the clock when the mail stated one", () => {
		const html = render({});
		assert.doesNotMatch(html, /Which clock is this on\?/);
		assert.doesNotMatch(html, /Pick a clock first/);
		assert.doesNotMatch(html, /aria-describedby/);
	});

	it("offers the clocks and dims Add while none is picked", () => {
		const html = render(twoClocks);
		assert.match(html, /Which clock is this on\?/);
		assert.match(html, /16:00 in Lisbon/);
		assert.match(html, /Pick a clock first/);
		assert.match(html, /aria-describedby/);
		assert.match(html, /opacity-55/);
	});

	it("undims Add once one of the clocks is picked", () => {
		const html = render(twoClocks, "Europe/Lisbon");
		assert.match(html, /aria-pressed="true"/);
		assert.doesNotMatch(html, /Pick a clock first/);
		assert.doesNotMatch(html, /aria-describedby/);
		assert.doesNotMatch(html, /opacity-55/);
	});
});
