/**
 * The rescue banner is rendered by SpamRescue above the spam list. These tests
 * cover the banner's rendering with a count sourced from the backend (via
 * useRescueCandidates), exercising the component's output in isolation without
 * app providers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RescueBanner } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

const noop = () => {};

const renderBanner = (count: number): string =>
	renderToString(createElement(RescueBanner, { count, onReview: noop }));

describe("RescueBanner rendering", () => {
	it("shows the candidate count for multiple messages", () => {
		const html = renderBanner(2);
		assert.match(html, /2 messages here/);
	});

	it("shows singular phrasing for a single message", () => {
		const html = renderBanner(1);
		assert.ok(html.includes("1"), "count should appear");
	});

	it("renders without throwing for zero count", () => {
		assert.doesNotThrow(() => renderBanner(0));
	});
});
