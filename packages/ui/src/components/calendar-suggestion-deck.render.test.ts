import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	CalendarSuggestionDeck,
	type CalendarSuggestionDeckProps,
} from "./calendar-suggestion-deck.js";

const base: CalendarSuggestionDeckProps = {
	children: createElement("p", null, "KL1693 Amsterdam → Lisbon"),
	hasCard: true,
	onConfirm: () => undefined,
	onReject: () => undefined,
	blocked: false,
	blockedReason: "",
	remaining: 3,
};

const render = (props: Partial<CalendarSuggestionDeckProps> = {}) =>
	renderToString(createElement(CalendarSuggestionDeck, { ...base, ...props }));

/** The rendered words, with React's text separators and wrapping taken out. */
const words = (props: Partial<CalendarSuggestionDeckProps> = {}) =>
	render(props)
		.replaceAll("<!-- -->", "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ");

describe("CalendarSuggestionDeck", () => {
	it("shows the top card and counts the rest", () => {
		assert.match(words(), /KL1693 Amsterdam/);
		assert.match(words(), /3 left/);
	});

	it("says the buttons are there, so a gesture is never the only way", () => {
		assert.match(
			words(),
			/swipe right to accept, left to drop, or use the buttons/,
		);
	});

	it("says what an empty deck means rather than drawing a blank frame", () => {
		const empty = words({ hasCard: false });
		assert.match(
			empty,
			/Nothing in your mail is waiting on a decision about time/,
		);
		assert.doesNotMatch(empty, /KL1693/);
		assert.doesNotMatch(empty, /left ·/);
	});

	it("takes the caller's words for an empty deck", () => {
		assert.match(
			words({ hasCard: false, emptyText: "You are through the queue." }),
			/You are through the queue/,
		);
	});

	it("keeps the gesture surface off the vertical axis it does not own", () => {
		assert.match(render(), /touch-pan-y/);
	});

	it("draws no swipe badge before the drag has committed to anything", () => {
		const html = render({ blocked: true, blockedReason: "Pick a clock" });
		assert.doesNotMatch(html, /Pick a clock/);
		assert.doesNotMatch(html, /Not this/);
	});
});
