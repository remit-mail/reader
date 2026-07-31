import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppTopBar, type AppTopBarProps } from "./app-top-bar.js";

const slot = (testId: string) =>
	createElement("div", { "data-testid": testId }, testId);

const render = (overrides: Partial<AppTopBarProps> = {}): string =>
	renderToString(
		createElement(AppTopBar, {
			search: slot("search"),
			...overrides,
		}),
	);

describe("AppTopBar", () => {
	it("renders the search slot — the bar's reason to exist", () => {
		assert.match(render(), /data-testid="search"/);
	});

	it("renders the action slot when supplied", () => {
		const html = render({ actions: slot("actions") });
		assert.match(html, /data-testid="actions"/);
	});

	it("omits the actions entirely rather than leaving an empty box", () => {
		assert.doesNotMatch(render(), /data-testid="actions"/);
	});

	it("lays the bar out leading · search · actions", () => {
		const html = render({ leading: slot("leading"), actions: slot("actions") });
		assert.ok(
			html.indexOf("leading") < html.indexOf("search") &&
				html.indexOf("search") < html.indexOf("actions"),
			"slots render in reading order",
		);
	});

	it("omits the leading box when no control is supplied", () => {
		assert.doesNotMatch(render(), /data-testid="leading"/);
	});

	it("widens the field on focus rather than resting wide", () => {
		const html = render();
		assert.match(html, /max-w-xs/, "resting width is modest");
		assert.match(html, /focus-within:max-w-lg/, "focus widens it");
	});

	it("carries no brand mark — the bar is search, not a masthead", () => {
		assert.doesNotMatch(render(), /remit/i);
	});

	it("is a banner landmark spanning the app, not a pane header", () => {
		assert.match(render(), /<header/);
		assert.match(render(), /w-full/);
	});
});
