import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarClash, EventDraft } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CalendarComposePane } from "@/components/calendar/CalendarComposePane";
import { CalendarCreateCard } from "./CalendarCreateCard";
import { CalendarDetailsForm } from "./CalendarDetailsForm";
import { CalendarFeedCard } from "./CalendarFeedCard";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`.
(globalThis as { React?: typeof React }).React = React;

const details = (problem = "", timezone = "Europe/Amsterdam") =>
	renderToString(
		createElement(CalendarDetailsForm, {
			calendarName: "Work",
			timezone,
			isBusy: false,
			problem,
			onSave: () => undefined,
			onDelete: () => undefined,
		}) as never,
	);

describe("CalendarDetailsForm", () => {
	it("offers the name, the zone, a save and a delete", () => {
		const html = details();
		assert.match(html, /value="Work"/);
		assert.match(html, /Europe\/Amsterdam/);
		assert.match(html, /Save changes/);
		assert.match(html, /Delete calendar/);
	});

	it("offers no zone as its own choice, read as UTC", () => {
		assert.match(details("", ""), /None \(read as UTC\)/);
	});

	it("keeps a zone the list does not hold rather than dropping it", () => {
		assert.match(details("", "Mars/Olympus"), /Mars\/Olympus/);
	});

	it("states a refusal in the server's words", () => {
		const html = details("cannot be removed");
		assert.match(html, /role="alert"/);
		assert.match(html, /Work was not changed/);
		assert.match(html, /cannot be removed/);
	});
});

describe("CalendarCreateCard", () => {
	const create = (problem = "") =>
		renderToString(
			createElement(CalendarCreateCard, {
				isBusy: false,
				problem,
				onCreate: () => Promise.resolve(true),
			}) as never,
		);

	it("asks for a name, an address and a zone", () => {
		const html = create();
		assert.match(html, /New calendar/);
		assert.match(html, />Name</);
		assert.match(html, />Address</);
		assert.match(html, />Time zone</);
		assert.match(html, /Add calendar/);
	});

	it("states a refused create where the button is", () => {
		const html = create("already addresses a calendar");
		assert.match(html, /The calendar was not added/);
		assert.match(html, /already addresses a calendar/);
	});
});

describe("CalendarFeedCard with details", () => {
	it("draws the calendar's settings above its address", () => {
		const html = renderToString(
			createElement(CalendarFeedCard, {
				calendarName: "Work",
				details: createElement("p", null, "calendar details here"),
				state: { status: "absent" },
				mintedUrl: "",
				isBusy: false,
				actionError: undefined,
				onMint: () => undefined,
				onRevoke: () => undefined,
				onDismissMinted: () => undefined,
				onRetry: () => undefined,
			}) as never,
		);
		assert.ok(
			html.indexOf("calendar details here") <
				html.indexOf("Create subscription address"),
		);
	});
});

describe("CalendarComposePane clashes", () => {
	const draft: EventDraft = {
		title: "Roadmap review",
		date: "2026-06-10",
		startTime: "10:00",
		endTime: "11:00",
		allDay: false,
		calendarId: "cal_work",
		location: "",
		guests: "",
		notes: "",
		repeat: "",
	};
	const pane = (clashes: CalendarClash[] | undefined) =>
		renderToString(
			createElement(CalendarComposePane, {
				title: "New event",
				calendars: [],
				draft,
				onChange: () => undefined,
				problem: "",
				saveLabel: "Add",
				isSaving: false,
				clashes,
				onSave: () => undefined,
				onCancel: () => undefined,
			}) as never,
		);

	it("names what the span runs into", () => {
		const html = pane([{ id: "a", label: "Board prep, Wed 10 June" }]);
		assert.match(
			html,
			/This clashes with something you have already agreed to/,
		);
		assert.match(html, /Board prep, Wed 10 June/);
	});

	it("says a checked span is clear", () => {
		assert.match(pane([]), /Nothing else is booked at this time/);
	});

	it("draws nothing before there is an answer", () => {
		const html = pane(undefined);
		assert.doesNotMatch(html, /Nothing else is booked/);
		assert.doesNotMatch(html, /This clashes/);
	});
});
