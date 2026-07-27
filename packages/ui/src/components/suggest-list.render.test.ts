import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SuggestList, type SuggestListProps } from "./suggest-list.js";

const noop = () => {};

const render = (overrides: Partial<SuggestListProps> = {}) =>
	renderToString(
		createElement(SuggestList, {
			id: "list",
			suggestions: [
				{
					value: "receipts@stripe.com",
					label: "Stripe",
					hint: "receipts@stripe.com",
					source: "selected",
				},
				{ value: "rides@lyft.com" },
			],
			activeIndex: -1,
			optionId: (index: number) => `list-option-${index}`,
			onPick: noop,
			onHighlight: noop,
			label: "From suggestions",
			...overrides,
		}),
	);

describe("SuggestList", () => {
	it("renders nothing when there is nothing to suggest", () => {
		assert.equal(render({ suggestions: [] }), "");
	});

	it("renders a labelled listbox of options", () => {
		const html = render();
		assert.match(html, /role="listbox"/);
		assert.match(html, /aria-label="From suggestions"/);
		assert.equal(html.match(/role="option"/g)?.length, 2);
		assert.match(html, /id="list-option-0"/);
	});

	it("falls back to the value when a suggestion carries no label", () => {
		assert.match(render(), /rides@lyft\.com/);
	});

	it("shows the hint and where a suggestion came from", () => {
		const html = render();
		assert.match(html, /Stripe/);
		assert.match(html, /selected/);
	});

	it("marks only the highlighted option as selected", () => {
		const html = render({ activeIndex: 1 });
		assert.equal(html.match(/aria-selected="true"/g)?.length, 1);
		assert.equal(html.match(/aria-selected="false"/g)?.length, 1);
	});
});
