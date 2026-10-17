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

describe("EventSuggestionCard", () => {
	it("puts the reading into words rather than a percentage", () => {
		assert.match(render({}), /Read cleanly/);
		assert.match(render({ confidence: 0.7 }), /Read with gaps/);
		assert.match(render({ confidence: 0.2 }), /Barely read/);
	});
});
