/**
 * Typing is the create path, so the field is never off screen and the reading
 * of the sentence is shown back with the words each part came from. Where the
 * sentence has two honest readings the reader is asked, and that question is a
 * control rather than a note — both are asserted here.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	AgendaComposer,
	type AgendaComposerProps,
	AgendaPhraseField,
	PhraseReading,
} from "./agenda-composer.js";
import type {
	AgendaParse,
	CalendarDescriptor,
	EventDraft,
} from "./calendar-types.js";

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
];

const draft: EventDraft = {
	title: "Lunch with Jane",
	date: "2026-06-12",
	startTime: "13:00",
	endTime: "14:00",
	allDay: false,
	calendarId: "c1",
	location: "",
	guests: "Jane",
	notes: "",
	repeat: "",
};

const parse: AgendaParse = {
	title: "Lunch with Jane",
	date: "2026-06-12",
	dateText: "friday",
	startTime: "13:00",
	startTimeText: "1pm",
	endTime: "14:00",
	durationMinutes: 60,
	durationText: "",
	attendees: ["Jane"],
	attendeesText: "with Jane",
	location: "",
	locationText: "",
	repeat: "",
	repeatText: "",
	assumptions: ["An hour, because the sentence never said."],
	unresolved: [],
	choices: [],
};

const ambiguous: AgendaParse = {
	...parse,
	unresolved: ["No place given."],
	choices: [
		{
			id: "which_friday",
			question: "Which Friday?",
			source: "friday",
			options: [
				{ id: "this", label: "12 June", date: "2026-06-12", startTime: "" },
				{ id: "next", label: "19 June", date: "2026-06-19", startTime: "" },
			],
			chosenId: "this",
		},
	],
};

const base: AgendaComposerProps = {
	phrase: "lunch with Jane friday 1pm",
	onPhraseChange: () => {},
	parse,
	picks: {},
	onPick: () => {},
	draft,
	onDraftChange: () => {},
	calendars,
	expanded: false,
	onToggleExpanded: () => {},
	onSave: () => {},
	onCancel: () => {},
	open: true,
	onOpen: () => {},
};

const render = (props: Partial<AgendaComposerProps> = {}) =>
	renderToString(createElement(AgendaComposer, { ...base, ...props }));

describe("AgendaPhraseField", () => {
	it("names the field rather than leaving the placeholder to do it", () => {
		const html = renderToString(
			createElement(AgendaPhraseField, {
				phrase: "",
				onPhraseChange: () => {},
				onOpen: () => {},
				onCommit: () => {},
			}),
		);
		assert.match(html, /aria-label="Describe the event"/);
		assert.match(html, /placeholder="lunch with Jane friday 1pm"/);
	});

	it("grows the field where a finger has to hit it", () => {
		const html = renderToString(
			createElement(AgendaPhraseField, {
				phrase: "",
				onPhraseChange: () => {},
				onOpen: () => {},
				onCommit: () => {},
				touch: true,
			}),
		);
		assert.match(html, /min-h-11/);
	});
});

describe("AgendaComposer", () => {
	it("folds the form away until the reader opens it", () => {
		assert.doesNotMatch(render({ open: false }), /Northwind/);
		assert.match(render(), /Northwind/);
	});

	it("shows the reading back with the words each part came from", () => {
		const html = render();
		assert.match(html, /When/);
		assert.match(html, /friday 1pm/);
		assert.match(html, /Fri 12 Jun 13:00 – 14:00/);
	});

	it("keeps the reading off screen while there is nothing to read", () => {
		const html = render({ phrase: "  " });
		assert.doesNotMatch(html, /An hour, because the sentence never said./);
		assert.doesNotMatch(html, /bg-accent-2-soft/);
	});

	it("says a date on its own when the sentence gave no clock", () => {
		const html = renderToString(
			createElement(PhraseReading, {
				parse: { ...parse, startTime: "", startTimeText: "" },
				picks: {},
				onPick: () => {},
			}),
		);
		assert.match(html, /Fri 12 Jun/);
		assert.doesNotMatch(html, /13:00/);
	});

	it("asks about a reading it could not settle instead of choosing", () => {
		const html = render({ parse: ambiguous });
		assert.match(html, /Which Friday\?/);
		assert.match(html, /12 June/);
		assert.match(html, /19 June/);
	});

	it("says which reading is currently applied", () => {
		const html = render({ parse: ambiguous });
		assert.match(html, /aria-pressed="true"/);
		assert.match(html, /aria-pressed="false"/);
	});

	it("lets an answer override the reading the parser chose", () => {
		const html = renderToString(
			createElement(PhraseReading, {
				parse: ambiguous,
				picks: { which_friday: "next" },
				onPick: () => {},
			}),
		);
		const chosen = html.indexOf('aria-pressed="true"');
		assert.ok(chosen > html.indexOf("12 June"), "the second option is pressed");
	});

	it("separates what it assumed from what the sentence never said", () => {
		assert.match(render(), /An hour, because the sentence never said\./);
		assert.match(render({ parse: ambiguous }), /No place given\./);
	});

	it("names the guests the sentence carried", () => {
		assert.match(render(), /with Jane/);
	});
});
