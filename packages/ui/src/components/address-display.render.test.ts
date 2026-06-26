import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	AddressDisplay,
	AddressList,
	type EnvelopeAddress,
} from "./address-display.js";

const named: EnvelopeAddress = {
	displayName: "Ada Lovelace",
	normalizedEmail: "ada@example.com",
};
const bare: EnvelopeAddress = { normalizedEmail: "grace@example.com" };

describe("AddressDisplay", () => {
	it("renders display name with the address in angle brackets", () => {
		const html = renderToString(
			createElement(AddressDisplay, { address: named }),
		);
		assert.match(html, /Ada Lovelace/);
		assert.match(html, /ada@example.com/);
	});

	it("falls back to the bare email when no display name", () => {
		const html = renderToString(
			createElement(AddressDisplay, { address: bare }),
		);
		assert.match(html, /grace@example.com/);
	});

	it("shows the trusted badge only when asked", () => {
		assert.match(
			renderToString(
				createElement(AddressDisplay, {
					address: named,
					showTrustedBadge: true,
				}),
			),
			/data-testid="trusted-sender-badge"/,
		);
		assert.doesNotMatch(
			renderToString(createElement(AddressDisplay, { address: named })),
			/trusted-sender-badge/,
		);
	});
});

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
