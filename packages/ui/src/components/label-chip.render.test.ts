import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LabelChip } from "./label-chip.js";

describe("LabelChip", () => {
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
