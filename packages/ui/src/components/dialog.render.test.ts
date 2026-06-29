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

	it("dims with a plain scrim; left slide-over has no background wash", () => {
		assert.match(render({}), /bg-canvas\/80/, "center modal keeps a dim scrim");
		assert.doesNotMatch(
			render({ anchor: "left" }),
			/bg-canvas/,
			"left drawer backdrop is transparent (no wash)",
		);
	});

	it("right slide-over mirrors left: transparent backdrop, pinned right edge", () => {
		const right = render({ anchor: "right" });
		assert.doesNotMatch(right, /backdrop-blur/, "right drawer has no blur");
		assert.doesNotMatch(
			right,
			/bg-canvas\/80/,
			"right drawer backdrop is transparent (no wash)",
		);
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
