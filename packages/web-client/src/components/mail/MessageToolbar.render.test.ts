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
import { MessageToolbar } from "./MessageToolbar";

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
		assert.match(html, /aria-label="Star"/);
		// No archive verb — Remit is IMAP-backed (move-to-folder is the equivalent).
		assert.doesNotMatch(html, /aria-label="Archive"/);
	});
});

/**
 * The reading-pane toolbar carries message context only (#49). Search, compose,
 * bug report and the account menu moved up into the app top bar, which spans
 * every pane. Two search fields on one screen fight over "/" and over focus, so
 * the absence of one here is the thing worth pinning.
 */
describe("MessageToolbar carries message context only (#49)", () => {
	const render = (hasThread: boolean): string =>
		renderToString(
			createElement(MessageToolbar, {
				hasThread,
				intelligenceOpen: false,
				canToggleIntelligence: true,
				onToggleIntelligence: () => undefined,
			}) as never,
		);

	it("mounts no search field", () => {
		for (const hasThread of [false, true]) {
			assert.doesNotMatch(render(hasThread), /aria-label="Search mail"/);
		}
	});

	it("carries no global actions — compose, bug report, account", () => {
		const html = render(true);
		assert.doesNotMatch(html, /aria-label="Compose"/);
		assert.doesNotMatch(html, /aria-label="Report a bug"/);
		assert.doesNotMatch(html, /aria-label="Account menu"/);
	});

	it("keeps the message verbs and the intelligence toggle", () => {
		const html = render(true);
		assert.match(html, /aria-label="Reply"/);
		assert.match(html, /aria-label="Star"/);
		assert.match(html, /intelligence sidebar/);
	});
});

/**
 * The toggle holds its slot whatever the view and the selection are (#52); it
 * reports "cannot act" by being disabled, not by leaving the bar.
 */
describe("MessageToolbar keeps the intelligence toggle in place (#52)", () => {
	const render = (canToggleIntelligence: boolean): string =>
		renderToString(
			createElement(MessageToolbar, {
				hasThread: false,
				intelligenceOpen: false,
				canToggleIntelligence,
				onToggleIntelligence: () => undefined,
			}) as never,
		);

	it("renders the toggle when it cannot open a rail", () => {
		assert.match(render(false), /aria-label="Show intelligence sidebar"/);
	});

	it("disables it rather than dropping it from the bar", () => {
		assert.match(render(false), /\sdisabled(=""|\s|>)/);
	});

	it("leaves it pressable once a rail can open", () => {
		assert.equal(/\sdisabled(=""|\s|>)/.test(render(true)), false);
	});
});
