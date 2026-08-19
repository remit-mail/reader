/**
 * `isWritingElsewhere` against a real focused element (#839) — mounted on jsdom
 * rather than a stub, so the `type` fallback is the platform's own and not one
 * the test agrees with.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isWritingElsewhere } from "./editor-focus.js";

const editor = document.createElement("div");

const focusInput = (type: string | null): void => {
	const input = document.createElement("input");
	if (type !== null) input.setAttribute("type", type);
	document.body.append(input);
	input.focus();
};

afterEach(() => {
	document.body.replaceChildren();
});

describe("isWritingElsewhere", () => {
	it("reads an input the platform renders as text as writing", () => {
		for (const type of [
			"text",
			"search",
			"email",
			"url",
			"tel",
			"password",
			"number",
			"date",
			"datetime-local",
			"month",
			"time",
			"week",
		]) {
			document.body.replaceChildren();
			focusInput(type);
			assert.equal(isWritingElsewhere(editor), true, type);
		}
	});

	it("reads an empty type as writing", () => {
		// HTML falls back to a text field, so the reader may be mid-sentence in it.
		focusInput("");
		assert.equal(isWritingElsewhere(editor), true);
	});

	it("reads an unrecognised type as writing", () => {
		focusInput("wibble");
		assert.equal(isWritingElsewhere(editor), true);
	});

	it("reads a missing type as writing", () => {
		focusInput(null);
		assert.equal(isWritingElsewhere(editor), true);
	});

	it("leaves the controls alone", () => {
		for (const type of [
			"button",
			"checkbox",
			"color",
			"file",
			"image",
			"radio",
			"range",
			"reset",
			"submit",
		]) {
			document.body.replaceChildren();
			focusInput(type);
			assert.equal(isWritingElsewhere(editor), false, type);
		}
	});

	it("ignores the case the type is written in", () => {
		focusInput("CheckBox");
		assert.equal(isWritingElsewhere(editor), false);
	});

	it("is not writing elsewhere when nothing holds the caret", () => {
		assert.equal(isWritingElsewhere(editor), false);
	});
});
