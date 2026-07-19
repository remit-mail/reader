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

	it("renders the leading and action slots when supplied", () => {
		const html = render({
			leading: slot("leading"),
			actions: slot("actions"),
		});
		assert.match(html, /data-testid="leading"/);
		assert.match(html, /data-testid="actions"/);
	});

	it("omits the optional slots entirely rather than leaving empty boxes", () => {
		const html = render();
		assert.doesNotMatch(html, /data-testid="leading"/);
		assert.doesNotMatch(html, /data-testid="actions"/);
	});

	it("lays the bar out leading · search · actions", () => {
		const html = render({
			leading: slot("leading"),
			actions: slot("actions"),
		});
		assert.ok(
			html.indexOf("leading") < html.indexOf("search") &&
				html.indexOf("search") < html.indexOf("actions"),
			"slots render in reading order",
		);
	});

	it("is a banner landmark spanning the app, not a pane header", () => {
		assert.match(render(), /<header/);
		assert.match(render(), /w-full/);
	});
});
