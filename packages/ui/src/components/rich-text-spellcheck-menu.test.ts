/**
 * Correcting a word, driven through a mounted editor: the menu opens over the
 * findings the marks already hold, the suggestions arrive after it, and what
 * the writer picks lands in the document as one undoable step.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	$getRoot as getRootType,
	LexicalEditor,
	UNDO_COMMAND as undoCommandType,
} from "lexical";
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
	SpellcheckOptions,
	SpellProvider,
	SuggestRequest,
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
const roots: Root[] = [];
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let useEffect: typeof reactUseEffect;
let createRoot: typeof reactCreateRoot;
let RichTextEditor: typeof RichTextEditorType;
let useLexicalComposerContext: () => [LexicalEditor];
let $getRoot: typeof getRootType;
let UNDO_COMMAND: typeof undoCommandType;
let desktopLayout = true;

const offsets = (): [number, number][] =>
	(
		(globalThis as unknown as MarkHost).CSS.highlights.get("spell-error")
			?.ranges ?? []
	).map((range) => [range.startOffset, range.endOffset]);

interface Stub extends SpellcheckOptions {
	readonly wordsAsked: SuggestRequest[];
	/** Settles the suggestions a held provider is sitting on. */
	release(): void;
}

const stubSpellcheck = (
	tune: { holdSuggestions?: boolean; failSuggestions?: string } = {},
): Stub => {
	const wordsAsked: SuggestRequest[] = [];
	const held: (() => void)[] = [];

	const answer = (request: CheckRequest): CheckResponse => ({
		requestId: request.requestId,
		revision: request.revision,
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
			listener({ state: "ready", language: "en" });
			return () => {};
		},
		check: (request) => Promise.resolve(answer(request)),
		suggest: (request) => {
			wordsAsked.push(request);
			if (tune.failSuggestions)
				return Promise.reject(new Error(tune.failSuggestions));
			const settled = {
				requestId: request.requestId,
				word: request.word,
				suggestions: stubSuggestionsFor(request.word),
			};
			if (!tune.holdSuggestions) return Promise.resolve(settled);
			return new Promise((resolve) => {
				held.push(() => resolve(settled));
			});
		},
		close: () => {},
	};

	return {
		wordsAsked,
		release: () => {
			for (const settle of held.splice(0)) settle();
		},
		provider: (language) =>
			Promise.resolve(language === "en" ? provider : null),
	};
};

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
	await act(async () => {
		const root = createRoot(container);
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

const settle = async (): Promise<void> => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
	});
};

const editable = (): HTMLElement => {
	const element = container.querySelector<HTMLElement>(
		"[data-testid=compose-body]",
	);
	if (!element) throw new Error("the editable surface is not mounted");
	return element;
};

const characters = (): Node => {
	const leaf = editable().querySelector("[data-lexical-text]")?.firstChild;
	if (!leaf) throw new Error("the document has no characters");
	return leaf;
};

/**
 * jsdom lays out nothing and moves no caret, so a selection Lexical set on its
 * own — `select()`, or an edit that carries the caret with it — lives only in
 * Lexical's own state. The next commit reconciles against the document's
 * selection, finds none, and puts the anchor back at the start. Everything
 * about a withheld mark is read off the caret at paint time, so a test that
 * left the browser's selection behind is asserting on whichever landed first:
 * the answer to the check, or the reconciliation that undoes the caret. The
 * browser is the one that does this; here the test has to.
 */
const putCaret = (offset: number): void => {
	dom.window.document.getSelection()?.setPosition(characters(), offset);
};

/**
 * The desktop popover portals to the document body, clear of whatever
 * ancestor would otherwise clip it, so the menu and its rows are found
 * against the document rather than the mounted `container` — the sheet below
 * the desktop gate stays in `container`, and this still reaches it there.
 */
const menu = (): HTMLElement | null =>
	dom.window.document.body.querySelector<HTMLElement>(
		"[data-testid=spell-menu]",
	);

const rows = (testId: string): HTMLElement[] => [
	...dom.window.document.body.querySelectorAll<HTMLElement>(
		`[data-testid=${testId}]`,
	),
];

/** Any element inside the menu, wherever it landed — see {@link menu}. */
const spellNode = (selector: string): HTMLElement | null =>
	dom.window.document.body.querySelector<HTMLElement>(selector);

/**
 * jsdom carries no `PointerEvent`, and what the editor reads off one is the
 * kind of pointer and where it went.
 */
const pointerEvent = (
	type: string,
	pointerType: string,
	at: { clientX: number; clientY: number; button?: number },
): MouseEvent => {
	const event = new dom.window.MouseEvent(type, { bubbles: true, ...at });
	Object.defineProperty(event, "pointerType", { value: pointerType });
	return event;
};

const pressDownAt = async (
	offset: number,
	pointerType: string,
	button = 0,
): Promise<void> => {
	putCaret(offset);
	await act(async () => {
		editable().dispatchEvent(
			pointerEvent("pointerdown", pointerType, {
				clientX: 40,
				clientY: 20,
				button,
			}),
		);
	});
};

const pressUp = async (
	pointerType: string,
	{ travel = 0, button = 0 }: { travel?: number; button?: number } = {},
): Promise<void> => {
	await act(async () => {
		editable().dispatchEvent(
			pointerEvent("pointerup", pointerType, {
				clientX: 40 + travel,
				clientY: 20,
				button,
			}),
		);
	});
};

const pressAt = async (
	offset: number,
	pointerType: string,
	{ travel = 0, button = 0 }: { travel?: number; button?: number } = {},
): Promise<void> => {
	await pressDownAt(offset, pointerType, button);
	await pressUp(pointerType, { travel, button });
};

const tapAt = (offset: number): Promise<void> => pressAt(offset, "touch");

const clickAt = (offset: number): Promise<void> => pressAt(offset, "mouse");

/** The caret the browser puts down where the click landed. */
const caretAt = async (
	editor: LexicalEditor,
	offset: number,
): Promise<void> => {
	await act(async () => {
		editor.update(() => {
			const [text] = $getRoot().getAllTextNodes();
			text?.select(offset, offset);
		});
	});
	putCaret(offset);
};

/** A key on the writing surface, whatever it turns out to do. */
const keyDownOn = async (key: string): Promise<void> => {
	await act(async () => {
		editable().dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

const chordAt = async (
	editor: LexicalEditor,
	offset: number,
): Promise<void> => {
	await caretAt(editor, offset);
	await act(async () => {
		editable().dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: ".",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
};

const click = async (element: HTMLElement): Promise<void> => {
	await act(async () => {
		element.click();
	});
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
	globalThis.KeyboardEvent = dom.window.KeyboardEvent;
	globalThis.DOMParser = dom.window.DOMParser;
	globalThis.MutationObserver = dom.window.MutationObserver;
	globalThis.Range = dom.window.Range;
	Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", {
		value: () => ({ top: 12, bottom: 24, left: 8, right: 40 }),
		configurable: true,
	});
	Object.defineProperty(dom.window.Element.prototype, "getBoundingClientRect", {
		value: () => ({ top: 0, bottom: 400, left: 0, right: 600 }),
		configurable: true,
	});
	// jsdom lays nothing out, and the sheet reads its own height to know how far
	// down it has been dragged.
	Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
		value: 360,
		configurable: true,
	});
	// The layout question every surface here answers: a popover on the word, or
	// the same rows in a sheet.
	Object.defineProperty(dom.window, "matchMedia", {
		value: () => ({
			matches: desktopLayout,
			addEventListener: () => {},
			removeEventListener: () => {},
		}),
		configurable: true,
	});
	globalThis.ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	} as unknown as typeof ResizeObserver;
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
	({ $getRoot, UNDO_COMMAND } = await import("lexical"));
	({ useLexicalComposerContext } = (await import(
		"@lexical/react/LexicalComposerContext"
	)) as unknown as { useLexicalComposerContext: () => [LexicalEditor] });
	({ RichTextEditor } = await import("./rich-text-editor.js"));
});

beforeEach(() => {
	desktopLayout = true;
	(globalThis as unknown as MarkHost).CSS.highlights.clear();
});

afterEach(async () => {
	const live = [...roots];
	roots.length = 0;
	await act(async () => {
		for (const mounted of live) mounted.unmount();
	});
	container.remove();
});

after(() => {
	dom.window.close();
});

describe("the correction menu", () => {
	it("opens on the word under the pointer and stands in for the suggestions until they land", async () => {
		const spellcheck = stubSpellcheck({ holdSuggestions: true });
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();

		await clickAt(1);

		assert.ok(menu(), "the menu is up before anything was asked for");
		assert.equal(
			rows("spell-suggestion-skeleton").length,
			3,
			"rows stand where the suggestions will be",
		);
		assert.equal(rows("spell-suggestion").length, 0);
		assert.equal(
			spellNode("[data-testid=spell-word]")?.textContent,
			"Ths",
			"the menu names the word it is about",
		);
		assert.deepEqual(
			spellcheck.wordsAsked.map((request) => request.word),
			["Ths"],
			"one word at a time, never the paragraph",
		);

		await act(async () => {
			spellcheck.release();
		});

		assert.equal(rows("spell-suggestion-skeleton").length, 0);
		assert.deepEqual(
			rows("spell-suggestion").map((row) => row.textContent),
			["The", "This", "Than", "That", "Them"],
			"five at most, dressed the way the word was written",
		);
		assert.equal(
			rows("spell-add-word").length,
			0,
			"no dictionary row without somewhere for the word to go",
		);
	});

	it("puts the caret's own word within reach of the keyboard", async () => {
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await chordAt(editor, 16);
		assert.deepEqual(
			offsets(),
			[[0, 3]],
			"the word being written carries no mark",
		);
		assert.equal(
			spellNode("[data-testid=spell-word]")?.textContent,
			"redy",
			"and is still what the menu opens on",
		);
	});

	it("replaces the word as one step, so one undo puts the misspelling back", async () => {
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await clickAt(1);
		const first = rows("spell-suggestion")[0];
		assert.ok(first, "a suggestion is offered");
		await click(first);

		assert.equal(editable().textContent, "The report is redy today");
		assert.equal(menu(), null, "the menu closed on the choice");

		await settle();
		assert.deepEqual(
			offsets(),
			[[14, 18]],
			"the word that was corrected lost its squiggle",
		);

		await act(async () => {
			editor.dispatchCommand(UNDO_COMMAND, undefined);
		});

		assert.equal(
			editable().textContent,
			SENTENCE,
			"one undo, not one per character",
		);
	});

	it("ignores a word for as long as the composer is open", async () => {
		const spellcheck = stubSpellcheck();
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();
		assert.equal(offsets().length, 2);

		await clickAt(1);
		const ignore = rows("spell-ignore")[0];
		assert.ok(ignore);
		await click(ignore);

		assert.deepEqual(offsets(), [[14, 18]], "the squiggle went with the word");
		assert.equal(menu(), null, "and the menu closed behind it");

		await act(async () => {
			editor.update(() => {
				$getRoot().getAllTextNodes()[0]?.setTextContent(`${SENTENCE}.`);
			});
		});
		await settle();

		assert.deepEqual(
			offsets(),
			[[14, 18]],
			"a later pass does not bring it back",
		);
	});

	it("offers the dictionary when the mount has somewhere to put the word", async () => {
		const added: string[] = [];
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: {
				...stubSpellcheck(),
				onAddWord: (word: string) => added.push(word),
			},
		});
		await settle();

		await clickAt(1);
		const add = rows("spell-add-word")[0];
		assert.ok(add, "the row is offered");
		await click(add);

		assert.deepEqual(added, ["Ths"], "the word went where the mount takes it");
		assert.deepEqual(offsets(), [[14, 18]], "and stopped being marked here");
	});

	it("says so when the suggestions could not be fetched", async () => {
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck({ failSuggestions: "the worker stopped" }),
		});
		await settle();

		await clickAt(1);

		assert.equal(rows("spell-suggestion-skeleton").length, 0);
		assert.match(
			spellNode("[data-testid=spell-suggestions-failed]")?.textContent ?? "",
			/the worker stopped/,
			"the menu says what happened rather than sitting empty",
		);
		assert.equal(
			rows("spell-ignore").length,
			1,
			"and what the writer can still do stays reachable",
		);
	});

	it("opens the sheet instead of the popover below the desktop gate", async () => {
		desktopLayout = false;
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await tapAt(1);

		assert.ok(menu(), "a tap in a marked word opens the corrections");
		assert.ok(
			spellNode("[aria-label='Close corrections']"),
			"and they arrive in a sheet, with its scrim",
		);
	});

	it("leaves a drag and a selection alone", async () => {
		desktopLayout = false;
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await pressAt(1, "touch", { travel: 40 });
		assert.equal(menu(), null, "a finger that travelled was selecting text");

		await pressAt(1, "mouse", { travel: 40 });
		assert.equal(menu(), null, "and so was a mouse that was dragged");

		dom.window.document
			.getSelection()
			?.setBaseAndExtent(characters(), 0, characters(), 3);
		await act(async () => {
			editable().dispatchEvent(
				pointerEvent("pointerdown", "touch", { clientX: 40, clientY: 20 }),
			);
			editable().dispatchEvent(
				pointerEvent("pointerup", "touch", { clientX: 40, clientY: 20 }),
			);
		});
		assert.equal(
			menu(),
			null,
			"lifting a finger off a selection does not cover it with a sheet",
		);
	});

	it("opens on a plain click and leaves the squiggle under it", async () => {
		const marked: [number, number][] = [
			[0, 3],
			[14, 18],
		];
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();
		assert.deepEqual(offsets(), marked);

		// The browser's own order: the press puts the caret in the word, and the
		// menu follows when the pointer comes up where it landed.
		await pressDownAt(1, "mouse");
		await caretAt(editor, 1);
		assert.deepEqual(
			offsets(),
			marked,
			"the word the caret was put down in keeps its mark",
		);

		await pressUp("mouse");
		assert.equal(
			spellNode("[data-testid=spell-word]")?.textContent,
			"Ths",
			"and the click is what opened the corrections",
		);

		await settle();
		assert.ok(menu(), "the menu is still up a pass later");
		assert.deepEqual(offsets(), marked, "and so are the marks");
	});

	it("leaves the right button to the browser", async () => {
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await pressAt(1, "mouse", { button: 2 });
		assert.equal(menu(), null, "the right button raises nothing of ours");

		const contextMenu = new dom.window.MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			editable().dispatchEvent(contextMenu);
		});
		assert.equal(
			contextMenu.defaultPrevented,
			false,
			"and nothing stands between the writer and the browser's own menu",
		);
		assert.equal(menu(), null);
	});

	it("gives the word back to the writer on the next key", async () => {
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await pressDownAt(1, "mouse");
		await caretAt(editor, 1);
		await pressUp("mouse");
		assert.deepEqual(
			offsets(),
			[
				[0, 3],
				[14, 18],
			],
			"the click left both marks standing",
		);

		// The caret walks out of the word it was clicked into and into the other
		// one. Nothing is edited on the way, so the key is the only thing that
		// says the writer is back.
		await keyDownOn("ArrowRight");
		await caretAt(editor, 16);
		await settle();
		assert.deepEqual(
			offsets(),
			[[0, 3]],
			"the word the caret walked into is being written again",
		);
	});

	it("still withholds the mark of a word an edit lands in", async () => {
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await clickAt(1);
		assert.equal(offsets().length, 2, "the click left both marks standing");

		// An edit with no key behind it, the way a paste or a correction arrives.
		await act(async () => {
			editor.update(() => {
				const [text] = $getRoot().getAllTextNodes();
				text?.spliceText(18, 0, "y", true);
			});
		});
		putCaret(19);
		await settle();

		assert.equal(editable().textContent, "Ths report is redyy today");
		assert.deepEqual(
			offsets(),
			[[0, 3]],
			"the word the edit landed in is not called wrong while it is written",
		);
	});

	it("closes on Escape and on a click somewhere else", async () => {
		await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await clickAt(1);
		assert.ok(menu());
		await act(async () => {
			menu()?.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		assert.equal(menu(), null, "Escape closes it");
		assert.equal(
			dom.window.document.activeElement,
			editable(),
			"and hands the message back its caret",
		);

		await clickAt(1);
		assert.ok(menu());
		await act(async () => {
			dom.window.document.body.dispatchEvent(
				new dom.window.MouseEvent("pointerdown", { bubbles: true }),
			);
		});
		assert.equal(menu(), null, "so does a press outside it");
	});

	it("goes when the document moves under it, and never writes where it was", async () => {
		const spellcheck = stubSpellcheck({ holdSuggestions: true });
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck,
		});
		await settle();

		await clickAt(1);
		assert.ok(menu(), "the menu is up while the suggestions are in flight");

		await act(async () => {
			spellcheck.release();
		});
		const [first] = rows("spell-suggestion");
		assert.ok(first);

		// The edit and the click land in the same turn, which is the race a
		// writer's own hands can produce.
		await act(async () => {
			editor.update(() => {
				$getRoot().getAllTextNodes()[0]?.setTextContent(`Well, ${SENTENCE}`);
			});
			first.click();
		});

		assert.equal(
			editable().textContent,
			`Well, ${SENTENCE}`,
			"the correction went nowhere rather than through the wrong letters",
		);
		assert.equal(menu(), null, "and the menu left with the offsets it held");
	});

	it("opens on a character, not on the gap before one", async () => {
		const editor = await mount({
			initialHtml: `<p>${SENTENCE}</p>`,
			lang: "en",
			spellcheck: stubSpellcheck(),
		});
		await settle();

		await clickAt(3);
		assert.equal(
			menu(),
			null,
			"the position after the last letter is already the space that follows",
		);

		await clickAt(0);
		assert.equal(
			spellNode("[data-testid=spell-word]")?.textContent,
			"Ths",
			"the first letter belongs to the word",
		);

		await act(async () => {
			menu()?.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		await chordAt(editor, 3);
		assert.equal(
			spellNode("[data-testid=spell-word]")?.textContent,
			"Ths",
			"a caret resting at the end of a word is still in it",
		);
	});
});
