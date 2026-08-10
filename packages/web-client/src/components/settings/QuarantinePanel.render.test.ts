/**
 * The pane in Settings › Advanced that is the only place a quarantined message
 * is ever mentioned. Every read state has to say something: an empty list is
 * the normal one, and a failed read is never a blank panel.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type QuarantineEntry, quarantineDemoEntries } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QuarantinePanelView } from "./QuarantinePanel";

// See MessageToolbar.render.test.ts: the SSR test loader transpiles remit-ui
// `.tsx` with the classic JSX runtime, which needs a global `React`.
(globalThis as { React?: typeof React }).React = React;

const render = (props: {
	entries: readonly QuarantineEntry[];
	isPending: boolean;
	error: Error | null;
}): string =>
	renderToString(createElement(QuarantinePanelView, props) as never);

describe("QuarantinePanelView", () => {
	it("says nothing was set aside rather than rendering nothing", () => {
		const html = render({ entries: [], isPending: false, error: null });
		assert.match(html, /Messages set aside/);
		assert.match(html, /Nothing is set aside/);
	});

	it("lists a set-aside message with a way to report it", () => {
		const html = render({
			entries: quarantineDemoEntries.slice(0, 1),
			isPending: false,
			error: null,
		});
		assert.match(html, /Cut a bug/);
		assert.match(html, /could not read/i);
	});

	it("calls more than one set aside a pattern, not a list", () => {
		const html = render({
			entries: quarantineDemoEntries,
			isPending: false,
			error: null,
		});
		assert.match(
			html,
			new RegExp(`${quarantineDemoEntries.length} messages could not be read`),
		);
	});

	it("reports a failed read in the pane, with a way to file it", () => {
		const html = render({
			entries: [],
			isPending: false,
			error: new Error("Failed to fetch"),
		});
		assert.match(html, /role="alert"/);
		assert.match(html, /could not be read/);
		assert.match(html, /Failed to fetch/);
		assert.match(html, /Report this/);
		assert.doesNotMatch(html, /Nothing is set aside/);
	});

	it("says it is still reading rather than claiming an empty list", () => {
		const html = render({ entries: [], isPending: true, error: null });
		assert.match(html, /Checking for messages set aside/);
		assert.doesNotMatch(html, /Nothing is set aside/);
	});
});
