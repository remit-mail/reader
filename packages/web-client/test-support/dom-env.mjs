/**
 * Browser globals for the unit-test processes.
 *
 * Installed from `register.mjs`, which the test command loads with `--import`,
 * so the globals exist before any test module — and therefore before
 * `react-dom` — is evaluated. React decides once, at module load, whether it is
 * running in a browser; installing a DOM later leaves it on its no-DOM
 * fallbacks and typing into an input throws.
 *
 * `matchMedia` is jsdom's one real gap here: it has no layout and no device, so
 * a viewport has to be declared. Tests that care set their own via the harness.
 */

import { JSDOM } from "jsdom";

export const DEFAULT_VIEWPORT_WIDTH = 1280;

export const DEFAULT_VIEWPORT = {
	width: DEFAULT_VIEWPORT_WIDTH,
	orientation: "landscape",
	pointer: "fine",
};

const FEATURES = {
	"min-width": (value, viewport) =>
		viewport.width >= Number.parseInt(value, 10),
	"max-width": (value, viewport) =>
		viewport.width <= Number.parseInt(value, 10),
	orientation: (value, viewport) => value === viewport.orientation,
	pointer: (value, viewport) => value === viewport.pointer,
};

const wrapsWholeCondition = (condition) => {
	if (!condition.startsWith("(")) return false;
	let depth = 0;
	for (let index = 0; index < condition.length; index += 1) {
		if (condition[index] === "(") depth += 1;
		else if (condition[index] === ")") {
			depth -= 1;
			if (depth === 0) return index === condition.length - 1;
		}
	}
	return false;
};

const splitOnAnd = (condition) => {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < condition.length; index += 1) {
		if (condition[index] === "(") depth += 1;
		else if (condition[index] === ")") depth -= 1;
		else if (depth === 0 && condition.startsWith(" and ", index)) {
			parts.push(condition.slice(start, index));
			index += 4;
			start = index + 1;
		}
	}
	parts.push(condition.slice(start));
	return parts;
};

const matchesCondition = (condition, viewport) => {
	const trimmed = condition.trim();
	if (wrapsWholeCondition(trimmed))
		return matchesCondition(trimmed.slice(1, -1), viewport);
	if (trimmed.startsWith("not "))
		return !matchesCondition(trimmed.slice(4), viewport);
	const parts = splitOnAnd(trimmed);
	if (parts.length > 1)
		return parts.every((part) => matchesCondition(part, viewport));
	const separator = trimmed.indexOf(":");
	const feature = FEATURES[trimmed.slice(0, separator).trim()];
	// An unmodelled feature (hover, prefers-color-scheme) reads as unsupported.
	return feature
		? feature(trimmed.slice(separator + 1).trim(), viewport)
		: false;
};

export const setViewport = (viewport) => {
	const device = { ...DEFAULT_VIEWPORT, ...viewport };
	Object.defineProperty(globalThis.window, "matchMedia", {
		configurable: true,
		value: (query) => ({
			media: query,
			matches: matchesCondition(query, device),
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
// A jsdom EventTarget accepts only jsdom's own AbortSignal, and a listener
// registered with one built from the default global — Node's, which is what
// `AbortController` resolves to here and what the resizable pane group uses —
// throws instead of registering. Swapping the global class is not the way out:
// Node's `Request` then rejects jsdom's signal and every mocked fetch fails.
// The listener registers without its removal signal; a test process is torn
// down whole, so nothing depends on removing it.
const addEventListenerWithSignal =
	window.EventTarget.prototype.addEventListener;
window.EventTarget.prototype.addEventListener = function addEventListener(
	type,
	listener,
	options,
) {
	if (
		options &&
		typeof options === "object" &&
		options.signal &&
		!(options.signal instanceof window.AbortSignal)
	) {
		return addEventListenerWithSignal.call(this, type, listener, {
			...options,
			signal: undefined,
		});
	}
	return addEventListenerWithSignal.call(this, type, listener, options);
};
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
	"SVGElement",
	"Node",
	"Document",
	"DocumentFragment",
	"ShadowRoot",
	"Range",
	"Selection",
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

setViewport(DEFAULT_VIEWPORT);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { dom, window };
