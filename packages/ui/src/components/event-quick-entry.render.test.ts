import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { parseEventPhrase } from "../lib/event-phrase.js";
import { EventQuickEntry } from "./event-quick-entry.js";

const NOW = new Date(2026, 5, 10, 9, 30);

const render = (phrase: string) =>
	renderToString(
		createElement(EventQuickEntry, {
			value: phrase,
			onChange: () => undefined,
			parse: parseEventPhrase(phrase, NOW),
			onCommit: () => undefined,
		}),
	);

describe("EventQuickEntry", () => {
	it("attributes each reading to the words it came from", () => {
		const html = render("lunch with Jane friday 1pm");
		assert.match(html, /lunch/);
		assert.match(html, /friday 1pm/);
		assert.match(html, /Jane/);
	});

	it("says what it assumed", () => {
		assert.match(render("standup tomorrow 9:30"), /No length given/);
	});

	it("says what it could not settle", () => {
		assert.match(render("design review monday"), /No time given/);
	});

	it("shows no reading before anything is typed", () => {
		const html = render("");
		assert.doesNotMatch(html, /WHEN|When<\/span>/);
	});
});
