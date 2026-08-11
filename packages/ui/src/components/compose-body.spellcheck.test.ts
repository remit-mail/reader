/**
 * The composer's checker, mounted through the surface the app mounts (#707).
 * The editor took a `spellcheck` option from the day the marks existed; what is
 * asserted here is that the composer carries one down to it, and that it is
 * opened for the language the composer is actually in — the one the chip and
 * detection settle on, not a second copy of that value.
 *
 * A language the build has no dictionary for is not a failure: the provider
 * answers null and the browser's own checking is switched back on, so the
 * writer never faces a surface that has silently stopped marking anything.
 *
 * A checker that was supposed to run and is not is the case that has to be
 * loud, in either of the two ways it happens — one that never opens, and one
 * that opens and then stops. Both say so through `onStatus`, both hand the
 * message back to the browser, and the second takes its own marks down on the
 * way out so nothing is left underlined by a checker that is gone.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type { ComposeBody as ComposeBodyType } from "./compose-body.js";
import type {
	CheckRequest,
	ProviderStatus,
	SpellcheckOptions,
	SpellProvider,
	SuggestRequest,
} from "./rich-text-spellcheck.js";

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let ComposeBody: typeof ComposeBodyType;

/** Short enough that detection declines and the chip stays on the account default. */
const DOCUMENT = "<p>Ths is redy.</p>";

class Marks {
	readonly ranges: Range[] = [];
	add(range: Range): void {
		this.ranges.push(range);
	}
}

/**
 * Stands in for the bundled word list: English has a dictionary and nothing
 * else does, which is the shape the real one has today.
 */
const recordingSpellcheck = (): {
	options: SpellcheckOptions;
	asked: string[];
	closed: string[];
} => {
	const asked: string[] = [];
	const closed: string[] = [];
	const options: SpellcheckOptions = {
		provider: (language) => {
			asked.push(language);
			if (language !== "en") return Promise.resolve(null);
			const provider: SpellProvider = {
				language,
				onStatus: (listener) => {
					listener({ state: "ready", language });
					return () => {};
				},
				check: (request: CheckRequest) =>
					Promise.resolve({
						requestId: request.requestId,
						revision: request.revision,
						findings: [],
					}),
				suggest: (request: SuggestRequest) =>
					Promise.resolve({
						requestId: request.requestId,
						word: request.word,
						suggestions: [],
					}),
				close: () => {
					closed.push(language);
				},
			};
			return Promise.resolve(provider);
		},
	};
	return { options, asked, closed };
};

/** A checker whose engine never loads, so nothing was ever opened to stop. */
const brokenSpellcheck = (): {
	options: SpellcheckOptions;
	statuses: ProviderStatus[];
} => {
	const statuses: ProviderStatus[] = [];
	return {
		options: {
			provider: () => Promise.reject(new Error("boom")),
			onStatus: (status) => statuses.push(status),
		},
		statuses,
	};
};

/** A checker that comes up, marks the message, and then stops running. */
const stoppingSpellcheck = (): {
	options: SpellcheckOptions;
	statuses: ProviderStatus[];
	stop: () => void;
} => {
	const statuses: ProviderStatus[] = [];
	const listeners: ((status: ProviderStatus) => void)[] = [];
	const options: SpellcheckOptions = {
		provider: (language) => {
			const provider: SpellProvider = {
				language,
				onStatus: (listener) => {
					listeners.push(listener);
					listener({ state: "ready", language });
					return () => {};
				},
				check: (request: CheckRequest) =>
					Promise.resolve({
						requestId: request.requestId,
						revision: request.revision,
						findings: request.spans.map((span) => ({
							spanId: span.spanId,
							start: 0,
							end: 3,
							kind: "spelling" as const,
							suggestions: ["This"],
						})),
					}),
				suggest: (request: SuggestRequest) =>
					Promise.resolve({
						requestId: request.requestId,
						word: request.word,
						suggestions: [],
					}),
				close: () => {},
			};
			return Promise.resolve(provider);
		},
		onStatus: (status) => statuses.push(status),
	};
	return {
		options,
		statuses,
		stop: () => {
			for (const listener of listeners)
				listener({
					state: "failed",
					language: "en",
					reason: "worker",
					detail: "the worker went away",
				});
		},
	};
};

const marked = (): [number, number][] =>
	(
		(
			globalThis as unknown as { CSS: { highlights: Map<string, Marks> } }
		).CSS.highlights.get("spell-error")?.ranges ?? []
	).map((range) => [range.startOffset, range.endOffset]);

const settle = async (): Promise<void> => {
	await act(async () => {
		await Promise.resolve();
	});
	await act(async () => {
		await Promise.resolve();
	});
};

/** Long enough for the editor's idle to expire and the pass to come back. */
const checked = async (): Promise<void> => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 300));
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

const chooseLanguage = async (tag: string): Promise<void> => {
	const chip = container.querySelector<HTMLElement>(
		"[data-testid=compose-language-chip]",
	);
	if (!chip) throw new Error("the language chip is not mounted");
	await act(async () => {
		chip.click();
	});
	const row = container.querySelector<HTMLElement>(
		`[role="menuitemradio"][lang="${tag}"]`,
	);
	if (!row) throw new Error(`the language menu offers no ${tag}`);
	await act(async () => {
		row.click();
	});
	await settle();
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
	// has neither half of. Without both, the editor draws nothing and never opens
	// a provider at all — which is the browser this suite would be testing.
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

const mount = async (options: SpellcheckOptions): Promise<void> => {
	await act(async () => {
		root = createRoot(container);
		root.render(
			createElement(ComposeBody, {
				mode: "rich",
				onModeChange: () => undefined,
				initialHtml: DOCUMENT,
				initialText: "Ths is redy.",
				onChange: () => undefined,
				onConversionError: () => undefined,
				onLanguageChange: () => undefined,
				languages: ["en", "nl"],
				spellcheck: options,
			}),
		);
	});
	await settle();
};

describe("the composer's spellchecker", () => {
	it("opens a checker for the language the message is being written in", async () => {
		const { options, asked } = recordingSpellcheck();

		await mount(options);

		assert.deepEqual(asked, ["en"]);
		assert.equal(
			editable().getAttribute("spellcheck"),
			"false",
			"the browser stops checking while ours is running",
		);
	});

	it("follows the chip: a new language is a new checker", async () => {
		const { options, asked, closed } = recordingSpellcheck();
		await mount(options);

		await chooseLanguage("nl");

		assert.deepEqual(asked, ["en", "nl"]);
		assert.deepEqual(
			closed,
			["en"],
			"the checker for the language left behind is taken down",
		);
	});

	it("hands the message back to the browser where there is no dictionary", async () => {
		const { options } = recordingSpellcheck();
		await mount(options);

		await chooseLanguage("nl");

		assert.equal(
			editable().getAttribute("spellcheck"),
			"true",
			"a language nothing here checks is still checked by the browser",
		);
	});

	it("names a checker that never came up, and hands the message back", async () => {
		const { options, statuses } = brokenSpellcheck();

		await mount(options);

		assert.deepEqual(
			statuses,
			[{ state: "failed", language: "en", reason: "worker", detail: "boom" }],
			"the composer hears why checking is not happening, in the shape it reports",
		);
		assert.equal(
			editable().getAttribute("spellcheck"),
			"true",
			"a checker that never started leaves the browser's own checking on",
		);
	});

	it("takes its marks down with a checker that stops mid-message", async () => {
		const { options, statuses, stop } = stoppingSpellcheck();
		await mount(options);
		await checked();

		assert.deepEqual(
			marked(),
			[[0, 3]],
			"the misspelling is marked while the checker is running",
		);

		await act(async () => {
			stop();
		});
		await settle();

		assert.deepEqual(
			statuses.map((status) => status.state),
			["ready", "failed"],
			"the stop is reported, not swallowed",
		);
		assert.deepEqual(marked(), [], "no mark outlives the checker that drew it");
		assert.equal(
			editable().getAttribute("spellcheck"),
			"true",
			"the browser takes the message back the moment ours stops",
		);
	});

	it("leaves the browser to it when the composer is handed no checker", async () => {
		await act(async () => {
			root = createRoot(container);
			root.render(
				createElement(ComposeBody, {
					mode: "rich",
					onModeChange: () => undefined,
					initialHtml: DOCUMENT,
					initialText: "Ths is redy.",
					onChange: () => undefined,
					onConversionError: () => undefined,
					onLanguageChange: () => undefined,
					languages: ["en", "nl"],
				}),
			);
		});
		await settle();

		assert.equal(
			editable().getAttribute("spellcheck"),
			"true",
			"a composer with no checker of its own is the composer as it shipped",
		);
	});
});
