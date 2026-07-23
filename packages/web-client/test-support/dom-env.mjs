/**
 * Browser globals for the unit-test processes.
 *
 * Installed from `register.mjs`, which the test command loads with `--import`,
 * so the globals exist before any test module — and therefore before
 * `react-dom` — is evaluated. React decides once, at module load, whether it is
 * running in a browser; installing a DOM later leaves it on its no-DOM
 * fallbacks and typing into an input throws.
 *
 * `matchMedia` is jsdom's one real gap here: it has no layout, so a viewport
 * width has to be declared. Tests that care set their own via the harness.
 */

import { JSDOM } from "jsdom";

export const DEFAULT_VIEWPORT_WIDTH = 1280;

export const setViewportWidth = (width) => {
	const matches = (query) => {
		const min = /min-width:\s*(\d+)px/.exec(query);
		if (min) return width >= Number(min[1]);
		const max = /max-width:\s*(\d+)px/.exec(query);
		if (max) return width <= Number(max[1]);
		return false;
	};
	Object.defineProperty(globalThis.window, "matchMedia", {
		configurable: true,
		value: (query) => ({
			media: query,
			matches: matches(query),
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}),
	});
};

const dom = new JSDOM(
	"<!doctype html><html><body><div id=root></div></body></html>",
	{ url: "http://localhost/" },
);

const { window } = dom;

window.HTMLElement.prototype.scrollIntoView = () => {};
// jsdom only supplies these under `pretendToBeVisual`, whose animation-frame
// loop holds the event loop open and hangs the test process on exit.
window.requestAnimationFrame = (callback) =>
	window.setTimeout(() => callback(Date.now()), 0);
window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);

for (const name of [
	"HTMLElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLFormElement",
	"HTMLSelectElement",
	"Element",
	"Node",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"MutationObserver",
	"DOMParser",
	"NodeFilter",
]) {
	globalThis[name] = window[name];
}

for (const name of [
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	globalThis[name] = window[name].bind(window);
}

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", {
	value: window.navigator,
	configurable: true,
});

setViewportWidth(DEFAULT_VIEWPORT_WIDTH);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { dom, window };
