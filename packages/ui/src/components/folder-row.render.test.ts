import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FolderRow, type FolderRowProps } from "./folder-row.js";

const render = (props: Partial<FolderRowProps>) =>
	renderToString(
		createElement(FolderRow, {
			label: "Travel",
			depth: 0,
			expanded: false,
			ariaLabel: "Move to Travel",
			...props,
		}),
	);

describe("FolderRow", () => {
	it("is a tree item that carries its nesting and its label", () => {
		const html = render({ depth: 2 });
		assert.match(html, /<button[^>]*role="treeitem"/);
		assert.match(html, /aria-level="3"/);
		assert.match(html, /aria-label="Move to Travel"/);
		assert.match(html, /aria-expanded="false"/);
		assert.match(html, />Travel</);
	});

	it("indents by its depth and leaves a root flush", () => {
		assert.match(render({ depth: 2 }), /width:28px/);
		assert.doesNotMatch(render({ depth: 0 }), /style="width/);
	});

	it("turns the chevron once its children are on screen", () => {
		assert.doesNotMatch(render({}), /rotate-90/);
		assert.match(render({ expanded: true }), /rotate-90/);
	});

	it("checks the row that is the destination", () => {
		const html = render({ selected: true });
		assert.match(html, /aria-selected="true"/);
		assert.match(html, /text-accent/);
	});

	it("leaves an unchosen row unselected and unchecked", () => {
		const html = render({});
		assert.match(html, /aria-selected="false"/);
		assert.doesNotMatch(html, /text-accent/);
	});

	it("marks where the messages live now without disabling anything", () => {
		const html = render({ current: true, currentTag: "current" });
		assert.match(html, /aria-current="true"/);
		assert.match(html, />current</);
		assert.doesNotMatch(html, /disabled/);
	});

	it("renders a context branch as readable, not operable", () => {
		const html = render({
			context: true,
			ariaLabel: "Travel (containing folder)",
		});
		assert.doesNotMatch(html, /<button/);
		assert.match(html, /<div[^>]*role="treeitem"/);
		assert.match(html, /aria-label="Travel \(containing folder\)"/);
		assert.match(html, /opacity-60/);
	});

	it("insets the hairline to where the label starts", () => {
		assert.match(render({ separated: true, depth: 1 }), /left:74px/);
		assert.match(
			render({ separated: true, depth: 1, context: true }),
			/left:74px/,
		);
		assert.doesNotMatch(render({ depth: 1 }), /left:74px/);
	});

	it("takes its place in a roving tab order", () => {
		assert.match(render({ tabIndex: 0 }), /tabindex="0"/);
		assert.match(render({ tabIndex: -1 }), /tabindex="-1"/);
	});
});
