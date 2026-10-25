/**
 * ErrorState is the shared "this didn't load" surface. Two things matter about
 * it: the message it shows comes from whatever the caller caught (which is
 * rarely an `Error`), and Retry only exists when there is something to retry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ErrorState, formatErrorMessage } from "./ErrorState";

(globalThis as { React?: typeof React }).React = React;

const render = (props: Parameters<typeof ErrorState>[0]): string =>
	renderToString(createElement(ErrorState, props) as never);

describe("formatErrorMessage", () => {
	it("uses an Error's message", () => {
		assert.equal(
			formatErrorMessage(new Error("imap timed out")),
			"imap timed out",
		);
	});

	it("passes a bare string through", () => {
		assert.equal(formatErrorMessage("nope"), "nope");
	});

	it("reads `message` off a plain object — what a rejected fetch body looks like", () => {
		assert.equal(formatErrorMessage({ message: "Bad Gateway" }), "Bad Gateway");
	});

	it("falls back for a shape it cannot read", () => {
		assert.equal(
			formatErrorMessage({ status: 500 }),
			"An unexpected error occurred",
		);
		assert.equal(formatErrorMessage(null), "An unexpected error occurred");
		assert.equal(
			formatErrorMessage({ message: 42 }),
			"An unexpected error occurred",
		);
	});
});

describe("ErrorState", () => {
	it("announces itself as an alert and shows the caught message", () => {
		const html = render({ error: new Error("mailbox unreachable") });
		assert.match(html, /role="alert"/);
		assert.match(html, /mailbox unreachable/);
		assert.match(html, /Couldn&#x27;t load content/);
	});

	it("takes a caller-supplied title over the default", () => {
		const html = render({ error: "x", title: "Couldn't load folders" });
		assert.match(html, /Couldn&#x27;t load folders/);
		assert.doesNotMatch(html, /load content/);
	});

	it("offers no Retry when the caller has no retry to give", () => {
		assert.doesNotMatch(render({ error: "x" }), /Retry/);
		assert.doesNotMatch(render({ error: "x", variant: "inline" }), /Retry/);
	});

	it("offers Retry in both variants when it can retry", () => {
		const retry = () => undefined;
		assert.match(render({ error: "x", onRetry: retry }), /Retry/);
		assert.match(
			render({ error: "x", onRetry: retry, variant: "inline" }),
			/Retry/,
		);
	});

	it("renders the inline variant as a single row, not the centred block", () => {
		const inline = render({ error: "x", variant: "inline" });
		const block = render({ error: "x" });
		assert.match(inline, /items-start/);
		assert.match(block, /justify-center/);
		assert.doesNotMatch(inline, /justify-center/);
	});
});
