import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ApiError } from "@/lib/api";
import { FilterActionError } from "./FilterActionError";

(globalThis as { React?: typeof React }).React = React;

const render = (error: unknown, title = "Couldn't turn the filter on") =>
	renderToString(
		createElement(FilterActionError, {
			title,
			error,
			onRetry: () => undefined,
			reportHref: (message: string) =>
				`https://example.test/new?body=${encodeURIComponent(message)}`,
		}) as never,
	);

describe("FilterActionError (#1103, #1354)", () => {
	it("shows a refusal with its fix and a report link, and no Retry", () => {
		const html = render(new ApiError("Pick a folder in the rule.", 400));
		assert.match(html, /Couldn(&#x27;|')t turn the filter on/);
		assert.match(html, /Pick a folder in the rule\./);
		assert.match(html, /Report an issue/);
		assert.match(html, /example\.test\/new\?body=Pick/);
		assert.doesNotMatch(html, />Retry</);
	});

	it("offers Retry when the server did not answer", () => {
		const html = render(new ApiError("Unavailable", 503));
		assert.match(html, />Retry</);
		assert.match(html, /Report an issue/);
	});

	it("names the filter a Run now could not start, with the server's reason", () => {
		const html = render(
			new ApiError("This filter is turned off or has expired.", 400),
			"Couldn't run Invoices",
		);
		assert.match(html, /Couldn(&#x27;|')t run Invoices/);
		assert.match(html, /turned off or has expired/);
		assert.match(html, /Report an issue/);
	});
});
