import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { PopoverMenu } from "./popover-menu.js";

const item = {
	key: "read",
	label: "Mark as read",
	onSelect: () => undefined,
};

describe("PopoverMenu", () => {
	it("renders the trigger with its accessible label and menu semantics", () => {
		const html = renderToString(
			createElement(PopoverMenu, {
				triggerLabel: "More actions",
				items: [item],
			}),
		);
		assert.match(html, /aria-label="More actions"/);
		assert.match(html, /aria-haspopup="menu"/);
		assert.match(html, /aria-expanded="false"/);
	});

	it("renders nothing when there are no items", () => {
		const html = renderToString(
			createElement(PopoverMenu, { triggerLabel: "More actions", items: [] }),
		);
		assert.equal(html, "");
	});
});
