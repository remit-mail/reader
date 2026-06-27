/**
 * Render invariants for the reading-pane toolbar (#799): the never-disable
 * tenet (`doc/rules/ux.md`). The toolbar's action buttons must stay pressable
 * even with no thread open — they no-op and explain rather than greying out.
 *
 * Asserted against the shared `MailActionToolbar` (remit-ui), which the live
 * `MessageToolbar` composes. Uses `react-dom/server` so no jsdom is needed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailActionToolbar } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";

// The node test loader transpiles remit-ui's `.tsx` (resolved through
// node_modules) with the classic JSX runtime, which references a global
// `React`. Vite/Storybook use the automatic runtime, so this shim only exists
// for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const render = (props: Parameters<typeof MailActionToolbar>[0]): string =>
	renderToString(createElement(MailActionToolbar, props) as never);

describe("MailActionToolbar never disables its action buttons (#799)", () => {
	it("renders no disabled button with no thread open", () => {
		const html = render({ hasThread: false });
		assert.equal(
			/\sdisabled(=""|\s|>)/.test(html),
			false,
			"no toolbar button may carry a `disabled` attribute",
		);
	});

	it("renders no disabled button with a thread open", () => {
		const html = render({ hasThread: true });
		assert.equal(/\sdisabled(=""|\s|>)/.test(html), false);
	});

	it("renders the inline explanation when supplied with no thread", () => {
		const html = render({
			hasThread: false,
			unavailableHint: "Open a message first",
		});
		assert.match(html, /Open a message first/);
		// Inline status, not a toast.
		assert.match(html, /role="status"/);
	});

	it("keeps the action buttons present (reply/flag) so they stay pressable", () => {
		const html = render({ hasThread: false });
		assert.match(html, /aria-label="Reply"/);
		assert.match(html, /aria-label="Flag"/);
		// No archive verb — Remit is IMAP-backed (move-to-folder is the equivalent).
		assert.doesNotMatch(html, /aria-label="Archive"/);
	});
});
