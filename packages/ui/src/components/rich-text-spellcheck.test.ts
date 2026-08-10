/**
 * The marks, driven through a mounted editor: a provider answers, the ranges
 * land in the highlight registry, and the document itself never changes. The
 * registry is stubbed because jsdom carries no CSS Custom Highlight API, so
 * what is asserted is the ranges the editor would have handed a browser.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type { $getRoot as getRootType, LexicalEditor } from "lexical";
import type {
	act as reactAct,
	createElement as reactCreateElement,
	useEffect as reactUseEffect,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type { RichTextEditor as RichTextEditorType } from "./rich-text-editor.js";
import type {
	CheckRequest,
	CheckResponse,
	Finding,
	ProviderStatus,
	SpellcheckOptions,
	SpellProvider,
} from "./rich-text-spellcheck.js";
import {
	stubKnows,
	stubSuggestionsFor,
} from "./rich-text-spellcheck-double.js";
import { findMisspellings } from "./rich-text-spellcheck-words.js";

const SENTENCE = "Ths report is redy today";
const IDLE_MS = 400;

class StubMarks {
	readonly ranges: Range[] = [];
	add(range: Range): void {
		this.ranges.push(range);
	}
}

interface MarkHost {
	CSS: { highlights: Map<string, StubMarks> };
	Highlight: typeof StubMarks;
}

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
const roots: Root[] = [];
const containers: HTMLElement[] = [];
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let useEffect: typeof reactUseEffect;
let createRoot: typeof reactCreateRoot;
let RichTextEditor: typeof RichTextEditorType;
let useLexicalComposerContext: () => [LexicalEditor];
let $getRoot: typeof getRootType;

const marks = (): StubMarks | undefined =>
	(globalThis as unknown as MarkHost).CSS.highlights.get("spell-error");

const offsets = (): [number, number][] =>
	(marks()?.ranges ?? []).map((range) => [range.startOffset, range.endOffset]);

interface Stub extends SpellcheckOptions {
	readonly asked: CheckRequest[];
	closed(): number;
	/** Drives the provider's own status, the way a worker falling over does. */
	push(status: ProviderStatus): void;
	/** Settles the answers a held provider is sitting on. */
	release(): void;
}

/** What the composer will hand the editor, without a worker in the way. */
const stubSpellcheck = (
	tune: {
		revisionOf?: (request: CheckRequest, nth: number) => number;
		hold?: boolean;
	} = {},
): Stub => {
	const asked: CheckRequest[] = [];
	const held: (() => void)[] = [];
	const listeners = new Set<(status: ProviderStatus) => void>();
	let closed = 0;

	const answer = (request: CheckRequest, nth: number): CheckResponse => ({
		requestId: request.requestId,
		revision: tune.revisionOf?.(request, nth) ?? request.revision,
		findings: request.spans.flatMap((span) =>
			findMisspellings(span.text, stubKnows).map(
				(range): Finding => ({
					spanId: span.spanId,
					start: range.start,
					end: range.end,
					kind: "spelling",
					suggestions: [],
				}),
			),
		),
	});

	const provider: SpellProvider = {
		language: "en",
		onStatus: (listener) => {
			listeners.add(listener);
			listener({ state: "ready", language: "en" });
			return () => {
				listeners.delete(listener);
			};
		},
		check: (request) => {
			asked.push(request);
			const response = answer(request, asked.length);
			if (!tune.hold) return Promise.resolve(response);
			return new Promise((resolve) => {
				held.push(() => resolve(response));
			});
		},
		suggest: (request) =>
			Promise.resolve({
				requestId: request.requestId,
				word: request.word,
				suggestions: stubSuggestionsFor(request.word),
			}),
		close: () => {
			closed += 1;
		},
	};

	return {
		asked,
		closed: () => closed,
		push: (status) => {
			for (const listener of listeners) listener(status);
		},
		release: () => {
			for (const settle of held.splice(0)) settle();
		},
		provider: (language) =>
			Promise.resolve(language === "en" ? provider : null),
	};
};

// A container is used once: React refuses to create a second root over one it
// has already owned. The editor reaches the test through a pinned control,
// which is the one place a caller's own node renders inside the composer.
const mount = async (
	props: Record<string, unknown>,
): Promise<LexicalEditor> => {
	let editor: LexicalEditor | undefined;
	const Probe = () => {
		const [found] = useLexicalComposerContext();
		useEffect(() => {
			editor = found;
		}, [found]);
		return null;
	};

	container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	containers.push(container);
	await act(async () => {
		root = createRoot(container);
		roots.push(root);
		root.render(
			createElement(RichTextEditor, {
				...props,
				trailing: createElement(Probe),
			}),
		);
	});
	if (!editor) throw new Error("the editor never reached the probe");
	return editor;
};

const unmountAll = async (): Promise<void> => {
	const live = [...roots];
	roots.length = 0;
	containers.length = 0;
	await act(async () => {
		for (const mounted of live) mounted.unmount();
	});
};

const unmountLast = async (): Promise<void> => {
	const last = roots.pop();
	containers.pop();
	await act(async () => {
		last?.unmount();
	});
};

const settle = async (): Promise<void> => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
	});
};

const editable = (scope: HTMLElement = container): HTMLElement => {
	const element = scope.querySelector<HTMLElement>(
		"[data-testid=compose-body]",
	);
	if (!element) throw new Error("the editable surface is not mounted");
	return element;
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
	// jsdom has no layout, and Lexical measures the caret's range whenever it
	// writes the DOM selection.
	Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", {
		value: () => ({
			top: 0,
			bottom: 0,
			left: 0,
			right: 0,
			width: 0,
			height: 0,
			x: 0,
			y: 0,
		}),
		configurable: true,
	});
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
	Object.defineProperty(globalThis, "CSS", {
		value: { highlights: new Map<string, StubMarks>() },
		configurable: true,
	});
	Object.defineProperty(globalThis, "Highlight", {
		value: StubMarks,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;

	({ act, createElement, useEffect } = await import("react"));
	({ createRoot } = await import("react-dom/client"));
	({ $getRoot } = await import("lexical"));
	({ useLexicalComposerContext } = (await import(
		"@lexical/react/LexicalComposerContext"
	)) as unknown as { useLexicalComposerContext: () => [LexicalEditor] });
	({ RichTextEditor } = await import("./rich-text-editor.js"));
});

beforeEach(() => {
	(globalThis as unknown as MarkHost).CSS.highlights.clear();
});

afterEach(async () => {
	await unmountAll();
	container.remove();
});

after(() => {
	dom.window.close();
});

describe("spellcheck marks", () => {
	it("marks the misspelt words in the document it opens on", async () => {
		const spellcheck = stubSpellcheck();
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();

		assert.deepEqual(offsets(), [
			[0, 3],
			[14, 18],
		]);
		assert.equal(
			marks()?.ranges[0]?.startContainer.textContent,
			SENTENCE,
			"the ranges sit on the text the reader sees",
		);
		assert.equal(
			editable().innerHTML.includes("mark"),
			false,
			"nothing entered the document",
		);
	});

	it("leaves the word the caret sits in alone", async () => {
		const spellcheck = stubSpellcheck();
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();

		const caretTo = async (offset: number) => {
			await act(async () => {
				editor.update(() => {
					const [text] = $getRoot().getAllTextNodes();
					text?.select(offset, offset);
				});
			});
			await settle();
		};

		await caretTo(16);
		assert.deepEqual(
			offsets(),
			[[0, 3]],
			"the word being written is not marked",
		);

		await caretTo(1);
		assert.deepEqual(
			offsets(),
			[[14, 18]],
			"leaving a word marks it and marks nothing else twice",
		);
	});

	it("marks what an edit touched and leaves the rest of the document alone", async () => {
		const spellcheck = stubSpellcheck();
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p><p>Notes</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();
		const opening = spellcheck.asked.length;

		await act(async () => {
			editor.update(() => {
				const written = $getRoot().getAllTextNodes().at(-1);
				written?.setTextContent("Notes recieve");
				written?.select(13, 13);
			});
		});
		await settle();

		const last = spellcheck.asked.at(-1);
		assert.ok(last, "the edit was checked");
		assert.equal(spellcheck.asked.length, opening + 1, "one pass per edit");
		assert.equal(
			last.spans.length,
			1,
			"only the leaf the edit touched was sent",
		);
		assert.equal(last.spans[0]?.text, "Notes recieve");
		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
			],
			"the marks in the untouched paragraph kept their offsets",
		);
	});

	it("drops an answer the document has moved past", async () => {
		const spellcheck = stubSpellcheck({
			revisionOf: (request) => request.revision - 1,
		});
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();

		assert.equal(spellcheck.asked.length, 1, "the document was checked");
		assert.equal(marks(), undefined, "a stale revision paints nothing");
	});

	it("hands checking back to the browser unless a provider is ready", async () => {
		await mount({ initialHtml: `<p>${SENTENCE}</p>`, lang: "en" });
		await settle();
		assert.equal(
			editable().getAttribute("spellcheck"),
			"true",
			"without the prop the browser checks, as it does today",
		);

		await unmountAll();

		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "de",
			spellcheck: stubSpellcheck(),
		});
		await settle();
		assert.equal(
			editable().getAttribute("spellcheck"),
			"true",
			"a language with no dictionary keeps the browser's own checking",
		);

		await unmountAll();

		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();
		assert.equal(
			editable().getAttribute("spellcheck"),
			"false",
			"two sets of squiggles never coexist",
		);
	});

	it("takes the marks off a leaf the moment its characters move", async () => {
		const spellcheck = stubSpellcheck();
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p><p>Notes redy</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();
		assert.deepEqual(offsets(), [
			[0, 3],
			[14, 18],
			[6, 10],
		]);

		await act(async () => {
			editor.update(() => {
				$getRoot().getAllTextNodes().at(-1)?.setTextContent("Well Notes redy");
			});
		});

		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
			],
			"the edited leaf loses its squiggles rather than wearing them on the wrong letters",
		);

		await settle();
		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
				[11, 15],
			],
			"and gets them back where the words now are",
		);
	});

	it("checks a leaf again when its answer came back too late", async () => {
		const spellcheck = stubSpellcheck({
			revisionOf: (request, nth) =>
				nth === 1 ? request.revision - 1 : request.revision,
		});
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();
		await settle();

		assert.equal(
			spellcheck.asked.length,
			2,
			"the dropped leaf was asked again",
		);
		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
			],
			"a dropped answer costs a pass, not the marks",
		);
	});

	it("clears its marks when the provider stops answering", async () => {
		const seen: ProviderStatus[] = [];
		const spellcheck = stubSpellcheck();
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: {
				...spellcheck,
				onStatus: (status: ProviderStatus) => seen.push(status),
			},
		});
		await settle();
		assert.equal(offsets().length, 2);

		await act(async () => {
			spellcheck.push({
				state: "failed",
				language: "en",
				reason: "worker",
				detail: "the worker stopped",
			});
		});

		assert.equal(marks(), undefined, "ours go when the browser's come back");
		assert.equal(editable().getAttribute("spellcheck"), "true");
		assert.equal(seen.at(-1)?.state, "failed", "the caller is told why");
	});

	it("says when a language has no dictionary", async () => {
		const seen: ProviderStatus[] = [];
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "de",
			spellcheck: {
				...stubSpellcheck(),
				onStatus: (status: ProviderStatus) => seen.push(status),
			},
		});
		await settle();

		assert.deepEqual(seen, [{ state: "unavailable", language: "de" }]);
		assert.equal(editable().getAttribute("spellcheck"), "true");
	});

	it("marks a leaf whose formatting nests its characters", async () => {
		const spellcheck = stubSpellcheck();
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();

		await act(async () => {
			editor.update(() => {
				$getRoot().getAllTextNodes()[0]?.toggleFormat("subscript");
			});
		});
		await settle();

		const nested = editable().querySelector("sub");
		assert.ok(nested, "the format put the text under a tag of its own");
		assert.notEqual(
			nested.firstChild?.nodeType,
			Node.TEXT_NODE,
			"the characters are no longer the element's first child",
		);
		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
			],
			"the marks found the characters anyway",
		);
	});

	it("keeps two editors' marks apart", async () => {
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await mount({
			initialHtml: "<p>Redy notes</p>",
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		assert.equal(offsets().length, 3, "both editors drew");

		await unmountLast();

		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
			],
			"closing one composer leaves the other's marks alone",
		);
		assert.equal(editable(containers[0]).getAttribute("spellcheck"), "false");
	});

	it("closes the provider and clears its marks when the editor goes away", async () => {
		const spellcheck = stubSpellcheck();
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();
		assert.equal(offsets().length, 2);

		await unmountAll();

		assert.equal(spellcheck.closed(), 1, "the provider was closed");
		assert.equal(marks(), undefined, "the marks left with it");
	});

	it("paints nothing when an answer lands after the editor closed", async () => {
		const spellcheck = stubSpellcheck({ hold: true });
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();
		assert.equal(spellcheck.asked.length, 1, "a check is in flight");

		await unmountAll();
		await act(async () => {
			spellcheck.release();
		});

		assert.equal(marks(), undefined, "a late answer draws into nothing");
	});
});
