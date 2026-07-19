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
	it("renders a real text input with an accessible label", () => {
		const html = render({ placeholder: "Search mail" });
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /placeholder="Search mail"/);
		assert.match(html, /value=""/);
	});

	it("renders one removable chip per narrowing term, in order", () => {
		const html = render({ chips: [SPAM, FROM] });
		assert.match(html, /in:spam/);
		assert.match(html, /from:acme/);
		assert.match(html, /aria-label="Remove filter: in:spam"/);
		assert.match(html, /aria-label="Remove filter: from:acme"/);
		assert.ok(
			html.indexOf("in:spam") < html.indexOf("from:acme"),
			"chips keep expression order",
		);
	});

	it("keeps chips and free text in the same field", () => {
		const html = render({ chips: [SPAM], value: "invoice" });
		assert.match(html, /in:spam/);
		assert.match(html, /value="invoice"/);
	});

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

	it("omits the inline clear when showClearButton is false", () => {
		const html = render({ value: "receipt", showClearButton: false });
		assert.doesNotMatch(html, /aria-label="Clear search"/);
		assert.match(html, /value="receipt"/);
	});

	it("carries a live region so a removal is never silent", () => {
		const html = render({ chips: [SPAM] });
		assert.match(html, /role="status"/);
		assert.match(html, /aria-live="polite"/);
	});

	it("renders the same field at either size", () => {
		for (const size of ["sm", "lg"] as const) {
			const html = render({ size, chips: [SPAM], value: "invoice" });
			assert.match(html, /aria-label="Search mail"/);
			assert.match(html, /in:spam/);
		}
	});

	it("takes a caller-supplied input id so a page can host more than one field", () => {
		assert.match(render({ inputId: "top-bar-search" }), /id="top-bar-search"/);
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

	it("differentiates a scope chip from a typed filter chip", () => {
		const scoped = render({ chips: [{ ...SPAM, tone: "scope" }] });
		const filter = render({ chips: [SPAM] });
		assert.notEqual(scoped, filter);
		assert.match(scoped, /accent-2/);
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

	it("still honours an explicit id when the caller needs a stable one", () => {
		const html = renderToString(
			createElement(SearchChipInput, {
				value: "",
				onChange: noop,
				onClear: noop,
				inputId: "top-bar-search",
			}),
		);
		assert.match(html, /<label[^>]*for="top-bar-search"/);
		assert.match(html, /<input[^>]*id="top-bar-search"/);
	});
});

describe("A read-only chip strip promises nothing it cannot do", () => {
	it("still renders the remove control so the strip looks the same", () => {
		// Removal is host-owned. Without a handler the chip cannot go anywhere, so
		// the field must not announce a removal or move focus as though it had —
		// see the guard in removeChipAt.
		const html = render({ chips: [SPAM] });
		assert.match(html, /aria-label="Remove filter: in:spam"/);
	});

	it("starts with an empty live region rather than a stale announcement", () => {
		const html = render({ chips: [SPAM], onRemoveChip: noop });
		assert.match(
			html,
			/role="status"[^>]*><\/span>|role="status"[^>]*>\s*<\/span>/,
		);
	});
});
