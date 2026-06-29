import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { EnvelopeAddress } from "./address-display.js";
import { MessageHeader, type MessageHeaderProps } from "./message-header.js";

const ada: EnvelopeAddress = {
	displayName: "Ada Lovelace",
	normalizedEmail: "ada@example.com",
};

const base: MessageHeaderProps = {
	subject: "Quarterly numbers",
	from: [ada],
	to: [{ normalizedEmail: "team@example.com" }],
	date: "Mon, 23 Jun 2026, 14:00",
	senderTrust: "wellknown",
};

describe("MessageHeader", () => {
	it("renders subject, addresses and the formatted date", () => {
		const html = renderToString(createElement(MessageHeader, base));
		assert.match(html, /Quarterly numbers/);
		assert.match(html, /Ada Lovelace/);
		assert.match(html, /team@example.com/);
		assert.match(html, /Mon, 23 Jun 2026, 14:00/);
	});

	it("shows a fallback for a missing subject", () => {
		const html = renderToString(
			createElement(MessageHeader, { ...base, subject: undefined }),
		);
		assert.match(html, /\(No subject\)/);
	});

	it("renders the category badge and trust indicator", () => {
		const html = renderToString(
			createElement(MessageHeader, {
				...base,
				category: "newsletter",
				senderTrust: "vip",
			}),
		);
		assert.match(html, /aria-label="Category: newsletter"/);
		assert.match(html, /aria-label="VIP sender"/);
	});

	it("renders an actions slot when provided", () => {
		const html = renderToString(
			createElement(MessageHeader, {
				...base,
				actions: createElement("button", { type: "button" }, "Menu"),
			}),
		);
		assert.match(html, /Menu/);
	});
});
