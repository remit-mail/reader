/**
 * The plain surface mounted for real: what a paste puts in it, what it does
 * when a paste has nothing to put there, and the toolbar it carries instead of
 * the formatting buttons.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComposeModeToggle } from "./compose-mode-toggle.js";
import { PlainTextEditor } from "./plain-text-editor.js";

const CLIPBOARD_HTML = [
	'<meta charset="utf-8">',
	'<h2 style="color:#c00">Quarterly numbers</h2>',
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
	'<script>fetch("https://tracker.example/steal")</script>',
].join("");

let container: HTMLElement;
let root: Root;

const surface = (): HTMLTextAreaElement => {
	const textarea = container.querySelector<HTMLTextAreaElement>(
		"[data-testid=compose-body-plain]",
	);
	if (!textarea) throw new Error("the plain surface is not mounted");
	return textarea;
};

// jsdom ships no `DataTransfer`, so the clipboard is the one thing the handler
// reads off the event: a `getData` over the flavours the copy carried.
const paste = async (flavours: { html?: string; text?: string }) => {
	const textarea = surface();
	const event = new Event("paste", {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, "clipboardData", {
		value: {
			getData: (type: string) =>
				(type === "text/html" ? flavours.html : flavours.text) ?? "",
		},
	});
	await act(async () => {
		textarea.dispatchEvent(event);
	});
};

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

/** A controlled surface: the value it shows is the one it last reported. */
const mount = async (
	initial = "",
	extra: {
		onSubmit?: () => void;
		initialCaret?: "start" | "end";
		trailing?: boolean;
	} = {},
): Promise<{ latest: () => string }> => {
	let value = initial;
	const render = () => {
		root.render(
			createElement(PlainTextEditor, {
				value,
				onChange: (next: string) => {
					value = next;
					render();
				},
				onSubmit: extra.onSubmit,
				initialCaret: extra.initialCaret,
				trailing: extra.trailing
					? createElement(ComposeModeToggle, {
							mode: "plain",
							onToggle: () => undefined,
						})
					: undefined,
			}),
		);
	};
	await act(async () => {
		root = createRoot(container);
		render();
	});
	return { latest: () => value };
};

describe("PlainTextEditor", () => {
	it("offers no formatting buttons, and says Markdown is read here", async () => {
		await mount();

		assert.equal(container.querySelectorAll("button").length, 0);
		assert.match(container.textContent ?? "", /Markdown/);
	});

	it("inserts a pasted web page as Markdown", async () => {
		const editor = await mount();

		await paste({ html: CLIPBOARD_HTML, text: "Quarterly numbers" });

		const text = editor.latest();
		assert.match(text, /## Quarterly numbers/);
		assert.match(text, /\| EMEA \| 412 \|/);
		assert.equal(text.includes("<h2"), false);
		assert.equal(text.includes("<script"), false);
		assert.equal(text.includes("color:#c00"), false);
	});

	it("inserts a clipboard with no HTML flavour verbatim", async () => {
		const editor = await mount();

		await paste({ text: "| not | a | table |" });

		assert.equal(editor.latest(), "| not | a | table |");
	});

	it("carries the mode toggle at the right of its toolbar", async () => {
		await mount("", { trailing: true });

		const toggle = container.querySelector("[data-testid=compose-mode-toggle]");
		assert.ok(toggle, "the toggle rides in the toolbar");
		assert.equal(toggle.getAttribute("aria-pressed"), "true");
		assert.equal(toggle.textContent, "Plain text");
	});

	it("takes focus with the caret at the end when it arrives on a switch", async () => {
		await mount("Everything written so far.", { initialCaret: "end" });

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});

		const textarea = surface();
		assert.equal(document.activeElement, textarea);
		assert.equal(textarea.selectionStart, textarea.value.length);
	});

	it("sends on Cmd+Enter", async () => {
		let sent = 0;
		await mount("Ready to go.", {
			onSubmit: () => {
				sent++;
			},
		});

		await act(async () => {
			surface().dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					key: "Enter",
					metaKey: true,
				}),
			);
		});

		assert.equal(sent, 1);
	});

	it("says so when a paste has nothing to insert", async () => {
		const editor = await mount();

		await paste({ html: '<img src="https://example.com/a.png">', text: "" });

		assert.equal(editor.latest(), "");
		assert.match(
			container.textContent ?? "",
			/Nothing to paste\. The copied content was an image, or had no text in it\./,
		);
	});
});
