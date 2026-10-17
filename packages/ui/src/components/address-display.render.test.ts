import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AddressList, type EnvelopeAddress } from "./address-display.js";

const named: EnvelopeAddress = {
	displayName: "Ada Lovelace",
	normalizedEmail: "ada@example.com",
};
const bare: EnvelopeAddress = { normalizedEmail: "grace@example.com" };

describe("AddressList", () => {
	it("renders nothing for an empty list", () => {
		assert.equal(
			renderToString(
				createElement(AddressList, { label: "To", addresses: [] }),
			),
			"",
		);
	});

	it("shows the expand control only when there are more than three addresses", () => {
		const three = [bare, bare, bare];
		const four = [bare, bare, bare, bare];
		assert.doesNotMatch(
			renderToString(
				createElement(AddressList, { label: "To", addresses: three }),
			),
			/aria-label="Expand"/,
		);
		assert.match(
			renderToString(
				createElement(AddressList, { label: "To", addresses: four }),
			),
			/aria-label="Expand"/,
		);
	});

	it("renders the trusted badge for trusted From addresses when enabled", () => {
		const trusted: EnvelopeAddress = {
			...named,
			flags: { trusted: { value: true } },
		};
		assert.match(
			renderToString(
				createElement(AddressList, {
					label: "From",
					addresses: [trusted],
					showTrustedBadge: true,
				}),
			),
			/trusted-sender-badge/,
		);
	});
});
