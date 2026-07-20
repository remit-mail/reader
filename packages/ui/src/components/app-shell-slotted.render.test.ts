import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { AppShellSlottedProps } from "./app-shell-slotted.js";
import { AppShellSlotted } from "./app-shell-slotted.js";

const render = (overrides: Partial<AppShellSlottedProps> = {}) =>
	renderToString(
		createElement(AppShellSlotted, {
			nav: createElement("div", { "data-testid": "nav" }, "Nav"),
			list: createElement("div", { "data-testid": "list" }, "List"),
			...overrides,
		}),
	);

describe("AppShellSlotted slot rendering", () => {
	it("renders the list slot unconditionally", () => {
		const html = render({ initialWidth: 800 });
		assert.match(html, /data-testid="list"/, "list slot is always rendered");
	});

	it("renders the reading slot at/above 1024px", () => {
		const html = render({
			initialWidth: 1100,
			reading: createElement("div", { "data-testid": "reading" }, "Reading"),
		});
		assert.match(
			html,
			/data-testid="reading"/,
			"reading pane appears at 1024px",
		);
	});

	it("hides the reading slot below 1024px", () => {
		const html = render({
			initialWidth: 800,
			reading: createElement("div", { "data-testid": "reading" }, "Reading"),
		});
		assert.doesNotMatch(
			html,
			/data-testid="reading"/,
			"reading pane is absent below 1024px",
		);
	});

	it("renders the intelligence slot at/above 1280px when intelligenceOpen", () => {
		const html = render({
			initialWidth: 1400,
			reading: createElement("div", { "data-testid": "reading" }, "Reading"),
			intelligence: createElement(
				"div",
				{ "data-testid": "intelligence" },
				"Intel",
			),
			intelligenceOpen: true,
		});
		assert.match(
			html,
			/data-testid="intelligence"/,
			"intelligence pane appears at 1280px",
		);
	});

	it("hides the intelligence slot when intelligenceOpen is false", () => {
		const html = render({
			initialWidth: 1400,
			reading: createElement("div", { "data-testid": "reading" }, "Reading"),
			intelligence: createElement(
				"div",
				{ "data-testid": "intelligence" },
				"Intel",
			),
			intelligenceOpen: false,
		});
		assert.doesNotMatch(
			html,
			/data-testid="intelligence"/,
			"intelligence pane is hidden when closed",
		);
	});

	it("renders the nav as a pane at/above 1024px (no folders trigger)", () => {
		const html = render({ initialWidth: 1100 });
		assert.match(html, /data-testid="nav"/, "nav is in the pane");
	});

	it("shows the header slot only below 1024px", () => {
		const headerEl = createElement(
			"div",
			{ "data-testid": "header" },
			"Header",
		);
		const narrowHtml = render({ initialWidth: 800, header: headerEl });
		const wideHtml = render({ initialWidth: 1100, header: headerEl });
		assert.match(
			narrowHtml,
			/data-testid="header"/,
			"header shows on narrow widths",
		);
		assert.doesNotMatch(
			wideHtml,
			/data-testid="header"/,
			"header is hidden at/above 1024px",
		);
	});

	it("renders the top bar above the panes, at every width", () => {
		const topBarEl = createElement("div", { "data-testid": "topbar" }, "Bar");
		for (const initialWidth of [800, 1100, 1400]) {
			const html = render({ initialWidth, topBar: topBarEl });
			assert.match(
				html,
				/data-testid="topbar"/,
				`top bar at ${initialWidth}px`,
			);
			assert.ok(
				html.indexOf('data-testid="topbar"') <
					html.indexOf('data-testid="list"'),
				`top bar precedes the pane group at ${initialWidth}px`,
			);
		}
	});

	it("omits the top bar when the caller passes none", () => {
		const html = render({ initialWidth: 1100 });
		assert.doesNotMatch(html, /data-testid="topbar"/);
	});

	it("hides the top bar with the rest of the layout while loading", () => {
		const html = render({
			isLoading: true,
			skeleton: createElement("div", { "data-testid": "skeleton" }, "Loading"),
			topBar: createElement("div", { "data-testid": "topbar" }, "Bar"),
		});
		assert.doesNotMatch(html, /data-testid="topbar"/);
	});

	it("renders the overlay regardless of width", () => {
		const overlayEl = createElement("div", { "data-testid": "overlay" }, "FAB");
		const narrowHtml = render({ initialWidth: 800, overlay: overlayEl });
		const wideHtml = render({ initialWidth: 1100, overlay: overlayEl });
		assert.match(narrowHtml, /data-testid="overlay"/, "overlay on narrow");
		assert.match(wideHtml, /data-testid="overlay"/, "overlay on desktop");
	});

	it("renders the skeleton when isLoading is true", () => {
		const html = render({
			isLoading: true,
			skeleton: createElement("div", { "data-testid": "skeleton" }, "Loading"),
		});
		assert.match(html, /data-testid="skeleton"/, "skeleton is rendered");
		assert.doesNotMatch(
			html,
			/data-testid="list"/,
			"list is hidden while loading",
		);
	});
});
