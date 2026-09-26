import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PaneHeader, type PaneHeaderProps } from "./pane-header.js";

const html = (props: PaneHeaderProps): string =>
	renderToString(createElement(PaneHeader, props));

describe("PaneHeader", () => {
	it("names the pane in its heading", () => {
		assert.match(html({ title: "Outbox" }), /<h1[^>]*>Outbox<\/h1>/);
	});

	it("draws no heading when the pane has no title", () => {
		assert.doesNotMatch(html({}), /<h1/);
	});

	it("sits on the pane-header datum", () => {
		assert.match(html({ title: "Outbox" }), /h-pane-header/);
	});
});
