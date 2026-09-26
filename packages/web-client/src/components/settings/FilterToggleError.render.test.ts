import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ApiError } from "@/lib/api";
import { FilterToggleError } from "./FilterToggleError";

(globalThis as { React?: typeof React }).React = React;

const render = (error: unknown) =>
	renderToString(
		createElement(FilterToggleError, {
			enabling: true,
			error,
			onRetry: () => undefined,
			reportHref: (message: string) =>
				`https://example.test/new?body=${encodeURIComponent(message)}`,
		}) as never,
	);

describe("FilterToggleError (#1103)", () => {
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
});
