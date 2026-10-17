import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	SearchChipInput,
	type SearchChipInputProps,
} from "./search-chip-input.js";

const noop = () => {};

const render = (overrides: Partial<SearchChipInputProps> = {}): string =>
	renderToString(
		createElement(SearchChipInput, {
			value: "",
			onChange: noop,
			onClear: noop,
			...overrides,
		}),
	);

const SPAM = { id: "in:spam", label: "in:spam" };
const FROM = { id: "from:acme", label: "from:acme" };

describe("SearchChipInput", () => {
	it("drops the placeholder once the expression carries a chip", () => {
		const html = render({ chips: [SPAM], placeholder: "Search mail" });
		assert.doesNotMatch(html, /placeholder="Search mail"/);
	});

	it("offers the clear control for a chip-only expression", () => {
		// A scope with no typed text is still a narrowed search — clearing must be
		// reachable without typing first.
		const html = render({ chips: [SPAM] });
		assert.match(html, /aria-label="Clear search"/);
	});

	it("omits the clear control while the expression is empty", () => {
		assert.doesNotMatch(render(), /aria-label="Clear search"/);
	});

	it("carries a live region so a removal is never silent", () => {
		const html = render({ chips: [SPAM] });
		assert.match(html, /role="status"/);
		assert.match(html, /aria-live="polite"/);
	});
});

describe("SearchChipInput chip semantics", () => {
	it("groups the chips as a labelled grid of rows", () => {
		const html = render({ chips: [SPAM, FROM] });
		assert.match(html, /role="grid"/);
		assert.match(html, /aria-label="Search filters"/);
		assert.equal(html.match(/role="row"/g)?.length, 2, "one row per chip");
	});

	it("names the label and the remove action as separate cells", () => {
		// A chip with a remove affordance has to announce both actions, not one.
		const html = render({ chips: [SPAM] });
		assert.equal(html.match(/role="gridcell"/g)?.length, 2);
	});

	it("omits the grid entirely when there are no chips", () => {
		assert.doesNotMatch(render(), /role="grid"/);
	});

	it("keeps the text input outside the grid, as its sibling", () => {
		const html = render({ chips: [SPAM] });
		const gridEnd = html.indexOf("</div>", html.indexOf('role="grid"'));
		assert.ok(
			html.indexOf('aria-label="Search mail"') > gridEnd,
			"the input renders after the grid closes",
		);
	});

	it("holds the whole field in a single tab stop", () => {
		// Exactly one thing is in the tab order — the text input, until a chip
		// takes it over. Everything else is reached by the arrow/backspace route,
		// so Tab never walks through the chips one at a time.
		const html = render({ chips: [SPAM, FROM] });
		assert.equal(
			html.match(/tabindex="0"/gi)?.length,
			1,
			"one tab stop for the whole field",
		);
		assert.ok((html.match(/tabindex="-1"/gi)?.length ?? 0) >= 6);
	});
});

describe("Two fields mounted at once stay independent", () => {
	// The field wraps itself in <label for>, and `for` binds to the first
	// matching id in tree order. A shared default id would therefore point the
	// second field's label at the first field's input — clicking one bar's
	// padding would focus the other. The desktop layout mounts two at once.
	const renderPair = (): string =>
		renderToString(
			createElement(
				"div",
				null,
				createElement(SearchChipInput, {
					value: "",
					onChange: noop,
					onClear: noop,
				}),
				createElement(SearchChipInput, {
					value: "",
					onChange: noop,
					onClear: noop,
				}),
			),
		);

	it("gives each field its own input id", () => {
		const ids = [...renderPair().matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(
			(m) => m[1],
		);
		assert.equal(ids.length, 2);
		assert.notEqual(ids[0], ids[1], "two fields must not share an input id");
	});

	it("points each label at its own input", () => {
		const html = renderPair();
		const labelTargets = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(
			(m) => m[1],
		);
		const inputIds = [...html.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(
			(m) => m[1],
		);
		assert.deepEqual(labelTargets, inputIds);
	});
});

describe("A read-only chip strip promises nothing it cannot do", () => {
	it("starts with an empty live region rather than a stale announcement", () => {
		const html = render({ chips: [SPAM], onRemoveChip: noop });
		assert.match(
			html,
			/role="status"[^>]*><\/span>|role="status"[^>]*>\s*<\/span>/,
		);
	});
});
