import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PullToRefresh } from "./pull-to-refresh.js";

const noop = () => Promise.resolve();
const list = createElement("ul", null, "messages");

describe("PullToRefresh", () => {
	it("renders its children inside the pull wrapper", () => {
		const html = renderToString(
			createElement(PullToRefresh, {
				onRefresh: noop,
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: list,
			}),
		);
		assert.match(html, /messages/);
		assert.match(html, /ptr/);
	});

	it("keeps the gesture pullable while not refreshing", () => {
		const html = renderToString(
			createElement(PullToRefresh, {
				onRefresh: noop,
				isRefreshing: false,
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: list,
			}),
		);
		assert.match(html, /ptr/);
	});

	it("still renders its children while a refresh is in flight", () => {
		const html = renderToString(
			createElement(PullToRefresh, {
				onRefresh: noop,
				isRefreshing: true,
				// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
				children: list,
			}),
		);
		assert.match(html, /messages/);
	});
});
