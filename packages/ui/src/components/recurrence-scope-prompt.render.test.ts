import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RecurrenceScopePrompt } from "./recurrence-scope-prompt.js";

const render = (touch = false) =>
	renderToString(
		createElement(RecurrenceScopePrompt, {
			title: "Standup",
			ruleText: "Every weekday at 09:15",
			instanceText: "Wednesday 10 June",
			onChoose: () => undefined,
			onCancel: () => undefined,
			touch,
		}),
	);

describe("RecurrenceScopePrompt", () => {
	it("offers all three scopes", () => {
		const html = render();
		assert.match(html, /This event/);
		assert.match(html, /This and everything after/);
		assert.match(html, /The whole series/);
	});

	it("states the rule and the instance that was clicked", () => {
		const html = render();
		assert.match(html, /Every weekday at 09:15/);
		assert.match(html, /Wednesday 10 June/);
	});

	it("grows the choices for a thumb", () => {
		assert.match(render(true), /min-h-11/);
	});
});
