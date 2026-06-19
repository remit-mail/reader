import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ComposeActionBar } from "./compose-action-bar.js";

const baseProps = {
	onSend: () => undefined,
	onDiscard: () => undefined,
	sending: false,
	canSend: true,
};

describe("ComposeActionBar", () => {
	it("renders Send and Discard, never disabled", () => {
		const html = renderToString(createElement(ComposeActionBar, baseProps));
		assert.match(html, /Send/);
		assert.match(html, /aria-label="Discard"/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("keeps Send pressable (no disabled) when it cannot send", () => {
		const html = renderToString(
			createElement(ComposeActionBar, {
				...baseProps,
				canSend: false,
				unavailableReason: "SMTP not configured",
			}),
		);
		assert.match(html, /Send/);
		assert.doesNotMatch(html, /disabled=""/);
		assert.match(html, /SMTP not configured/);
	});

	it("uses aria-busy while sending", () => {
		const html = renderToString(
			createElement(ComposeActionBar, { ...baseProps, sending: true }),
		);
		assert.match(html, /aria-busy="true"/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("keeps the Send pill at a fixed min-height so it does not clip", () => {
		const html = renderToString(createElement(ComposeActionBar, baseProps));
		assert.match(html, /min-h-11/);
	});
});
