/**
 * Render invariants for the shared reading-pane zero-state and the keyboard
 * hint bar (#785). Both ship as remit-ui components consumed by the live mail
 * routes. Uses `react-dom/server` so no jsdom is needed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeyboardHintBar, ReadingPaneEmpty } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";

// See MessageToolbar.render.test.ts: the SSR test loader transpiles remit-ui
// `.tsx` with the classic JSX runtime, which needs a global `React`.
(globalThis as { React?: typeof React }).React = React;

describe("ReadingPaneEmpty (#785)", () => {
	it("renders the prompt and the j/k/Enter Kbd hints by default", () => {
		const html = renderToString(createElement(ReadingPaneEmpty) as never);
		assert.match(html, /Select a thread to read/);
		assert.match(html, /<kbd[^>]*>j<\/kbd>/);
		assert.match(html, /<kbd[^>]*>k<\/kbd>/);
		assert.match(html, /<kbd[^>]*>Enter<\/kbd>/);
	});

	it("can hide the hint line on touch surfaces", () => {
		const html = renderToString(
			createElement(ReadingPaneEmpty, { showHints: false }) as never,
		);
		assert.equal(/<kbd/.test(html), false);
	});
});

describe("KeyboardHintBar (#785)", () => {
	it("renders the default hint set", () => {
		const html = renderToString(createElement(KeyboardHintBar) as never);
		assert.match(html, /navigate/);
		assert.match(html, /archive/);
		assert.match(html, /mute/);
		assert.match(html, /all shortcuts/);
		assert.match(html, /<kbd[^>]*>j<\/kbd>/);
	});
});
