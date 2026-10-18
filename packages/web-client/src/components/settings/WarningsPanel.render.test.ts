import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WarningsPanelView, type WarningsRead } from "./WarningsPanel";

// See MessageToolbar.render.test.ts: the SSR test loader transpiles remit-ui
// `.tsx` with the classic JSX runtime, which needs a global `React`.
(globalThis as { React?: typeof React }).React = React;

const render = (read: WarningsRead): string =>
	renderToString(
		createElement(WarningsPanelView, {
			read,
			signIn: createElement("button", { type: "button" }, "Sign in again"),
		}) as never,
	);

const ready = (
	over: Partial<Extract<WarningsRead, { kind: "Ready" }>>,
): WarningsRead => ({
	kind: "Ready",
	quarantine: [],
	warnings: [],
	warningsTotal: 0,
	...over,
});

describe("WarningsPanelView", () => {
	it("says nothing failed and nothing is set aside rather than rendering nothing", () => {
		const html = render(ready({}));
		assert.match(html, /Messages that failed to sync/);
		assert.match(html, /Nothing has failed/);
		assert.match(html, /Messages set aside/);
		assert.match(html, /Nothing is set aside/);
	});

	it("reports a failed read in the pane, with a way to file it", () => {
		const html = render({
			kind: "Failed",
			error: new Error("Failed to fetch"),
		});
		assert.match(html, /role="alert"/);
		assert.match(html, /could not be read/);
		assert.match(html, /Failed to fetch/);
		assert.match(html, /Report this/);
		assert.doesNotMatch(html, /Nothing has failed/);
		assert.doesNotMatch(html, /Nothing is set aside/);
	});

	it("says it is still reading rather than claiming an empty list", () => {
		const html = render({ kind: "Pending" });
		assert.match(html, /Checking for warnings/);
		assert.doesNotMatch(html, /Nothing has failed/);
	});
});
