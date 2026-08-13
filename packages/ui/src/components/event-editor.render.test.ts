import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { CalendarDescriptor, EventDraft } from "./calendar-types.js";
import { EventEditor } from "./event-editor.js";

const calendars: CalendarDescriptor[] = [
	{
		id: "c1",
		accountId: "a1",
		accountLabel: "Work",
		name: "Northwind",
		color: "cal-1",
	},
	{
		id: "c2",
		accountId: "a2",
		accountLabel: "Personal",
		name: "Family",
		color: "cal-3",
	},
];

const draft: EventDraft = {
	title: "Coffee",
	date: "2026-06-12",
	startTime: "13:00",
	endTime: "14:00",
	allDay: false,
	calendarId: "c1",
	location: "",
	guests: "",
	notes: "",
	repeat: "",
};

const render = (props: Partial<Parameters<typeof EventEditor>[0]>) =>
	renderToString(
		createElement(EventEditor, {
			draft,
			onChange: () => undefined,
			calendars,
			expanded: false,
			onToggleExpanded: () => undefined,
			onSave: () => undefined,
			onCancel: () => undefined,
			...props,
		}),
	);

/** The same render read as a document, so no assertion depends on attribute order. */
const parse = (props: Partial<Parameters<typeof EventEditor>[0]>) =>
	JSDOM.fragment(render(props));

const field = (dom: DocumentFragment, label: string) =>
	dom.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

const saveControl = (dom: DocumentFragment, label = "Add") =>
	[...dom.querySelectorAll("button")].find(
		(button) => button.textContent === label,
	);

const alertText = (dom: DocumentFragment) =>
	dom.querySelector('[role="alert"]')?.textContent ?? "";

describe("EventEditor", () => {
	it("folds everything but title, when and calendar", () => {
		const html = render({});
		assert.match(html, /aria-label="Title"/);
		assert.match(html, /aria-label="Start time"/);
		assert.match(html, /Northwind/);
		assert.doesNotMatch(html, /aria-label="Location"/);
		assert.match(html, /More details/);
	});

	it("reveals the rest on request", () => {
		const html = render({ expanded: true });
		assert.match(html, /aria-label="Location"/);
		assert.match(html, /aria-label="Guests"/);
		assert.match(html, /aria-label="Repeat"/);
		assert.match(html, /Fewer details/);
	});

	it("drops the clock fields for an all-day entry", () => {
		const html = render({ draft: { ...draft, allDay: true } });
		assert.doesNotMatch(html, /aria-label="Start time"/);
	});

	it("offers Delete only when editing something that exists", () => {
		assert.doesNotMatch(render({}), /Delete/);
		assert.match(render({ onDelete: () => undefined }), /Delete/);
	});

	it("names the save action the caller asked for", () => {
		assert.match(render({ saveLabel: "Save changes" }), /Save changes/);
	});

	it("says so and holds the save when the end is before the start", () => {
		const dom = parse({
			draft: { ...draft, startTime: "23:00", endTime: "01:00" },
		});
		assert.match(alertText(dom), /Ends before it starts/);
		assert.equal(saveControl(dom)?.disabled, true);
		assert.equal(
			field(dom, "Start time")?.getAttribute("aria-invalid"),
			"true",
		);
		assert.equal(field(dom, "End time")?.getAttribute("aria-invalid"), "true");
	});

	it("keeps what was typed rather than swapping the two fields", () => {
		const dom = parse({
			draft: { ...draft, startTime: "23:00", endTime: "01:00" },
		});
		assert.equal(field(dom, "Start time")?.value, "23:00");
		assert.equal(field(dom, "End time")?.value, "01:00");
	});

	it("lets a normal range save", () => {
		const dom = parse({});
		assert.equal(alertText(dom), "");
		assert.equal(saveControl(dom)?.disabled, false);
	});

	it("has no range to reject once the entry is all day", () => {
		const dom = parse({
			draft: { ...draft, startTime: "23:00", endTime: "01:00", allDay: true },
		});
		assert.equal(alertText(dom), "");
		assert.equal(saveControl(dom)?.disabled, false);
	});
});
