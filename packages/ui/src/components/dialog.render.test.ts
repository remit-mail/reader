import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Dialog } from "./dialog.js";

const render = (props: Partial<Parameters<typeof Dialog>[0]>) =>
	renderToString(
		createElement(Dialog, {
			open: true,
			onClose: () => {},
			title: "Folders",
			// biome-ignore lint/correctness/noChildrenProp: React 19 types require children in props object when using createElement
			children: createElement("span", null, "nav content"),
			...props,
		}),
	);

describe("Dialog backdrop", () => {
	it("never frosts the content behind it (no blur, just a dim scrim)", () => {
		const center = render({});
		const left = render({ anchor: "left" });
		assert.doesNotMatch(center, /backdrop-blur/, "center modal has no blur");
		assert.doesNotMatch(left, /backdrop-blur/, "left drawer has no blur");
	});

	it("dims what it covers, at every anchor", () => {
		for (const anchor of ["center", "left", "right"] as const) {
			assert.match(
				render(anchor === "center" ? {} : { anchor }),
				/bg-canvas\/80/,
				`${anchor} dialog dims the content behind it`,
			);
		}
	});

	it("right slide-over mirrors left, pinned to the other edge", () => {
		const right = render({ anchor: "right" });
		assert.doesNotMatch(right, /backdrop-blur/, "right drawer has no blur");
		assert.match(right, /justify-end/, "panel is pinned to the right edge");
		assert.match(right, /border-l/, "right drawer has a left hairline");
	});

	it("renders nothing when closed, so it never covers the content", () => {
		assert.equal(
			render({ open: false }),
			"",
			"closed dialog renders no markup",
		);
	});
});
