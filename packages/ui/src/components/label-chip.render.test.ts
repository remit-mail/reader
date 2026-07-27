import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LabelChip } from "./label-chip.js";

describe("LabelChip", () => {
	it("renders the label's name and a dot in its color", () => {
		const html = renderToString(
			createElement(LabelChip, {
				label: { labelId: "l1", name: "Receipts", color: "Blue" },
			}),
		);
		assert.match(html, /Receipts/);
		assert.match(html, /bg-blue-500/);
	});

	it("falls back to the neutral dot for an unrecognized color", () => {
		const html = renderToString(
			createElement(LabelChip, {
				label: { labelId: "l1", name: "Mystery", color: "Chartreuse" },
			}),
		);
		assert.match(html, /bg-fg-subtle/);
	});

	it("renders no remove affordance without onRemove", () => {
		const html = renderToString(
			createElement(LabelChip, {
				label: { labelId: "l1", name: "Receipts", color: "Blue" },
			}),
		);
		assert.doesNotMatch(html, /Remove label/);
	});

	it("renders a remove button naming the label when onRemove is wired", () => {
		const html = renderToString(
			createElement(LabelChip, {
				label: { labelId: "l1", name: "Receipts", color: "Blue" },
				onRemove: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Remove label Receipts"/);
	});
});
