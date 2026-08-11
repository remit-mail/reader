/**
 * The language of a message a Dutch writer types on an English browser, all the
 * way through the surface: the chip, the tag on the writing surface, and the
 * dictionary the checker is opened for.
 *
 * The account that has never been to the language setting is the ordinary case,
 * and what it falls back on has to be a set detection can choose inside — a set
 * of one is detection switched off, and the message then goes out tagged `en`
 * with every Dutch word underlined.
 *
 * React is imported after the jsdom globals are installed so its DOM bindings
 * bind to jsdom's prototypes.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import { defaultComposeLanguages } from "../lib/compose-language.js";
import type { ComposeBody as ComposeBodyType } from "./compose-body.js";
import type {
	SpellcheckOptions,
	SpellProvider,
} from "./rich-text-spellcheck.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let ComposeBody: typeof ComposeBodyType;

/** What the published image stages, per `REMIT_SPELLCHECK_LANGUAGES`. */
const BUILT = ["en", "en-GB", "nl"];

/** An English browser, which is what a Dutch writer routinely reads mail on. */
const BROWSER = ["en-US", "en"];

const DUTCH = "OK nou dank je wel hoor flapsigaar";

class Marks {
	readonly ranges: Range[] = [];
	add(range: Range): void {
		this.ranges.push(range);
	}
}

const recordingSpellcheck = (): {
	options: SpellcheckOptions;
	asked: string[];
} => {
	const asked: string[] = [];
	const options: SpellcheckOptions = {
		provider: (language) => {
			asked.push(language);
			const provider: SpellProvider = {
				language,
				onStatus: (listener) => {
					listener({ state: "ready", language });
					return () => {};
				},
				check: (request) =>
					Promise.resolve({
						requestId: request.requestId,
						revision: request.revision,
						findings: [],
					}),
				suggest: (request) =>
					Promise.resolve({
						requestId: request.requestId,
						word: request.word,
						suggestions: [],
					}),
				close: () => {},
			};
			return Promise.resolve(provider);
		},
	};
	return { options, asked };
};

const settle = async (): Promise<void> => {
	await act(async () => {
		await Promise.resolve();
	});
	await act(async () => {
		await Promise.resolve();
	});
};

/** Past the detection debounce, which is what the chip waits on. */
const detected = async (): Promise<void> => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 600));
	});
	await settle();
};

const editable = (): HTMLElement => {
	const surface = container.querySelector<HTMLElement>(
		"[data-testid=compose-body]",
	);
	if (!surface) throw new Error("the writing surface is not mounted");
	return surface;
};

const chip = (): HTMLElement => {
	const control = container.querySelector<HTMLElement>(
		"[data-testid=compose-language-chip]",
	);
	if (!control) throw new Error("the language chip is not mounted");
	return control;
};

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	dom = new JSDOMCtor(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.Node = dom.window.Node;
	globalThis.Event = dom.window.Event;
	globalThis.MouseEvent = dom.window.MouseEvent;
	globalThis.DOMParser = dom.window.DOMParser;
	globalThis.MutationObserver = dom.window.MutationObserver;
	globalThis.Range = dom.window.Range;
	globalThis.AbortController = dom.window.AbortController;
	globalThis.AbortSignal = dom.window.AbortSignal;
	globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
	globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
		dom.window,
	);
	globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
		dom.window,
	);
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	// The marks are drawn through the CSS Custom Highlight registry, which jsdom
	// has neither half of, and without it no checker is opened at all.
	Object.defineProperty(globalThis, "CSS", {
		value: { highlights: new Map<string, Marks>() },
		configurable: true,
	});
	Object.defineProperty(globalThis, "Highlight", {
		value: Marks,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;

	({ act, createElement } = await import("react"));
	({ createRoot } = await import("react-dom/client"));
	({ ComposeBody } = await import("./compose-body.js"));
});

beforeEach(() => {
	container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
});

after(() => {
	dom.window.close();
});

const mount = async (
	text: string,
	languages: readonly string[],
	spellcheck?: SpellcheckOptions,
): Promise<void> => {
	await act(async () => {
		root = createRoot(container);
		root.render(
			createElement(ComposeBody, {
				mode: "rich",
				onModeChange: () => undefined,
				initialHtml: `<p>${text}</p>`,
				initialText: text,
				onChange: () => undefined,
				onConversionError: () => undefined,
				onLanguageChange: () => undefined,
				languages,
				spellcheck,
			}),
		);
	});
	await settle();
};

describe("the language a message is written in", () => {
	it("reads Dutch off the body of an account that never chose a language", async () => {
		const { options, asked } = recordingSpellcheck();

		await mount(DUTCH, defaultComposeLanguages(BROWSER, BUILT), options);
		await detected();

		assert.equal(chip().dataset.language, "nl");
		assert.equal(chip().dataset.languageSource, "detected");
		assert.equal(chip().textContent, "NL");
		assert.equal(editable().getAttribute("lang"), "nl");
		assert.equal(
			asked.at(-1),
			"nl",
			"the checker follows the language, so the underlines are Dutch ones",
		);
	});

	it("stays on the account default while the body is English", async () => {
		await mount(
			"Thanks a lot, I will send you a new proposal tomorrow.",
			defaultComposeLanguages(BROWSER, BUILT),
		);
		await detected();

		assert.equal(chip().dataset.language, "en");
		assert.equal(editable().getAttribute("lang"), "en");
	});
});
