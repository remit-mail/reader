/**
 * The editor mounted for real: a document it opens on renders as structure, and
 * the value it reports back is the HTML that would be sent.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RichTextEditor } from "./rich-text-editor.js";
import type { RichTextValue } from "./rich-text-value.js";

const DOCUMENT = [
	"<h2>Quarterly numbers</h2>",
	"<ul><li>Revenue up</li></ul>",
	"<table><tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
].join("");

let container: HTMLElement;
let root: Root;

/** The toolbar acts on mousedown, so a click alone never reaches it. */
const press = (scope: HTMLElement, label: string): void => {
	const button = scope.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	if (!button) throw new Error(`no toolbar button labelled ${label}`);
	button.dispatchEvent(
		new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
	);
};

// A container is used once. React refuses to create a second root over one it
// has already owned, and the editor holds a contenteditable that outlives the
// unmount otherwise.
beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
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
	});
});

/**
 * The writing surface is loaded on its own chunk, so it mounts whenever that
 * chunk arrives rather than when the composer opened. A reader who pressed
 * Compose and started typing in the search field, the recipients or the subject
 * is mid-sentence by then, and the caret is theirs.
 */
describe("RichTextEditor opening on a caret", () => {
	const mount = async (): Promise<void> => {
		await act(async () => {
			root = createRoot(container);
			root.render(createElement(RichTextEditor, { initialCaret: "start" }));
		});
		// The caret is claimed off a timer, so let it run.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};

	it("takes the caret when nothing else holds it", async () => {
		await mount();

		const editable = container.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		assert.ok(editable, "the editable surface is mounted");
		assert.equal(document.activeElement === editable, true);
	});

	it("leaves the caret in a field the reader is typing in", async () => {
		const elsewhere = document.createElement("input");
		elsewhere.setAttribute("aria-label", "Search mail");
		document.body.append(elsewhere);
		elsewhere.focus();

		await mount();

		const holder = document.activeElement?.getAttribute("aria-label");
		elsewhere.remove();
		assert.equal(
			holder,
			"Search mail",
			`the caret ended up on ${holder ?? "nothing"}`,
		);
	});
});
