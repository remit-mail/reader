/**
 * The editor mounted for real: a document it opens on renders as structure, and
 * the value it reports back is the HTML that would be sent. React is imported
 * after the jsdom globals are installed so its DOM bindings bind to jsdom's
 * prototypes.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import type {
	act as reactAct,
	createElement as reactCreateElement,
} from "react";
import type { Root, createRoot as reactCreateRoot } from "react-dom/client";
import type { RichTextEditor as RichTextEditorType } from "./rich-text-editor.js";
import type { RichTextValue } from "./rich-text-value.js";

const DOCUMENT = [
	"<h2>Quarterly numbers</h2>",
	"<ul><li>Revenue up</li></ul>",
	"<table><tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
].join("");

let dom: JSDOM;
let container: HTMLElement;
let root: Root;
let act: typeof reactAct;
let createElement: typeof reactCreateElement;
let createRoot: typeof reactCreateRoot;
let RichTextEditor: typeof RichTextEditorType;

/** The toolbar acts on mousedown, so a click alone never reaches it. */
const press = (scope: HTMLElement, label: string): void => {
	const button = scope.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	if (!button) throw new Error(`no toolbar button labelled ${label}`);
	button.dispatchEvent(
		new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
	);
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
	globalThis.DOMParser = dom.window.DOMParser;
	globalThis.MutationObserver = dom.window.MutationObserver;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;

	({ act, createElement } = await import("react"));
	({ createRoot } = await import("react-dom/client"));
	({ RichTextEditor } = await import("./rich-text-editor.js"));

	const mount = dom.window.document.getElementById("root");
	if (!mount) throw new Error("unreachable: the mount point is missing");
	container = mount;
});

after(() => {
	dom.window.close();
});

describe("RichTextEditor", () => {
	it("renders the document it opens on and reports it back", async () => {
		const seen: RichTextValue[] = [];

		await act(async () => {
			root = createRoot(container);
			root.render(
				createElement(RichTextEditor, {
					initialHtml: DOCUMENT,
					onChange: (value: RichTextValue) => {
						seen.push(value);
					},
				}),
			);
		});

		const editable = container.querySelector("[data-testid=compose-body]");
		assert.ok(editable, "the editable surface is mounted");
		assert.ok(editable.querySelector("h2"), "the heading renders as a heading");
		assert.ok(editable.querySelector("ul li"), "the list renders as a list");
		assert.ok(
			editable.querySelector("table td"),
			"the table renders as a table",
		);

		const latest = seen.at(-1);
		assert.ok(latest, "the editor reported its value");
		assert.match(latest.html, /<table/);
		assert.match(latest.text, /## Quarterly numbers/);

		await act(async () => {
			root.unmount();
		});
	});

	it("offers the formatting controls the composer ships with", async () => {
		await act(async () => {
			root = createRoot(container);
			root.render(createElement(RichTextEditor, {}));
		});

		const labels = [...container.querySelectorAll("button")].map((button) =>
			button.getAttribute("aria-label"),
		);
		assert.deepEqual(labels, [
			"Bold (Ctrl+B)",
			"Italic (Ctrl+I)",
			"Link (Ctrl+K)",
			"Blockquote",
			"Undo (Ctrl+Z)",
			"Redo (Ctrl+Y)",
		]);

		await act(async () => {
			root.unmount();
		});
	});

	it("asks for an address rather than inserting an empty link", async () => {
		await act(async () => {
			root = createRoot(container);
			root.render(createElement(RichTextEditor, {}));
		});

		assert.equal(
			container.querySelector("[aria-label='Link address']"),
			null,
			"the address field stays out of the way until it is asked for",
		);

		await act(async () => {
			press(container, "Link (Ctrl+K)");
		});

		const field = container.querySelector<HTMLInputElement>(
			"[aria-label='Link address']",
		);
		assert.ok(field, "clicking Link opens the address field");
		assert.equal(field.value, "https://");

		await act(async () => {
			root.unmount();
		});
	});
});
