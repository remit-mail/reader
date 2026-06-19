import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FieldLabel } from "./field-label.js";

describe("FieldLabel", () => {
	it("renders a real label element wired to a control via htmlFor", () => {
		const html = renderToString(
			createElement(FieldLabel, { htmlFor: "host" }, "Host"),
		);
		assert.match(html, /<label/);
		assert.match(html, /for="host"/);
		assert.match(html, />Host</);
	});
});
