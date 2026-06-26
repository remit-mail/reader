import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AddressTag } from "./address-tag.js";

describe("AddressTag", () => {
	it("renders the display name when present", () => {
		const html = renderToString(
			createElement(AddressTag, {
				email: "alex@example.com",
				displayName: "Alex Rivera",
				onRemove: () => {},
			}),
		);
		assert.match(html, /Alex Rivera/);
	});

	it("falls back to the bare address when no display name", () => {
		const html = renderToString(
			createElement(AddressTag, {
				email: "sam@example.com",
				onRemove: () => {},
			}),
		);
		assert.match(html, /sam@example\.com/);
	});

	it("labels the remove button with the address", () => {
		const html = renderToString(
			createElement(AddressTag, {
				email: "alex@example.com",
				displayName: "Alex Rivera",
				onRemove: () => {},
			}),
		);
		assert.match(html, /aria-label="Remove alex@example\.com"/);
	});
});
