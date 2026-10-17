import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { useVisualViewport } from "./useVisualViewport";

let harness: DomHarness | undefined;

function KeyboardProbe() {
	const { isKeyboardOpen } = useVisualViewport();
	return createElement("p", null, isKeyboardOpen ? "open" : "closed");
}

const mount = (): {
	dom: DomHarness;
	fullHeight: number;
	resize: (height: number) => void;
} => {
	const fullHeight = window.innerHeight;
	const viewport = Object.assign(new window.EventTarget(), {
		height: fullHeight,
	});
	Object.defineProperty(window, "visualViewport", {
		configurable: true,
		value: viewport,
	});
	const dom = createDomHarness();
	harness = dom;
	dom.render(createElement(KeyboardProbe));
	return {
		dom,
		fullHeight,
		resize: (height) => {
			viewport.height = height;
			dom.dispatch(viewport, new window.Event("resize"));
		},
	};
};

afterEach(() => {
	harness?.close();
	harness = undefined;
	Reflect.deleteProperty(window, "visualViewport");
});

describe("the software keyboard", () => {
	it("reads as open once the visual viewport shrinks past the threshold, and closed again when it restores", () => {
		const { dom, fullHeight, resize } = mount();
		assert.equal(dom.text(), "closed");

		resize(fullHeight - 400);
		assert.equal(dom.text(), "open");

		resize(fullHeight);
		assert.equal(dom.text(), "closed");
	});

	it("stays closed when only the address bar collapses", () => {
		const { dom, fullHeight, resize } = mount();
		resize(fullHeight - 50);
		assert.equal(dom.text(), "closed");
	});
});
