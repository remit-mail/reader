import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	NewFolderAction,
	type NewFolderActionProps,
} from "./new-folder-action.js";

const render = (props: Partial<NewFolderActionProps>) =>
	renderToString(
		createElement(NewFolderAction, {
			label: "New folder",
			ariaLabel: "New folder",
			onOpen: () => {},
			...props,
		}),
	);

describe("NewFolderAction", () => {
	it("says what it makes, and where", () => {
		const html = render({ ariaLabel: "New folder inside Travel" });
		assert.match(html, /<button[^>]*aria-label="New folder inside Travel"/);
		assert.match(html, />New folder</);
	});

	it("takes the dashed add affordance where it is the pinned action", () => {
		const html = render({});
		assert.match(html, /data-prominence="prominent"/);
		assert.match(html, /border-dashed/);
	});

	it("stays neutral where it is the last thing inside a folder", () => {
		const html = render({ prominence: "quiet", depth: 1 });
		assert.match(html, /data-prominence="quiet"/);
		assert.doesNotMatch(html, /border-dashed/);
		assert.match(html, /width:14px/);
	});

	it("insets the hairline to where the label starts", () => {
		assert.match(render({ separated: true, depth: 1 }), /left:74px/);
		assert.doesNotMatch(render({ depth: 1 }), /left:74px/);
	});
});
