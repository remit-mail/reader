import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	SenderTrustIndicator,
	selectSenderTrustVariant,
} from "./sender-trust-indicator.js";

describe("selectSenderTrustVariant", () => {
	test("vip renders sparkles at every size", () => {
		assert.equal(selectSenderTrustVariant("vip", "sm"), "vip");
		assert.equal(selectSenderTrustVariant("vip", "md"), "vip");
	});

	test("wellknown is hidden at every size", () => {
		assert.equal(selectSenderTrustVariant("wellknown", "sm"), "hidden");
		assert.equal(selectSenderTrustVariant("wellknown", "md"), "hidden");
	});

	test("unknown is hidden on inbox rows (sm) — most senders default to unknown post-rollout, so a per-row pill would be noise", () => {
		assert.equal(selectSenderTrustVariant("unknown", "sm"), "hidden");
	});

	test("unknown shows the pill only at md (open-message header) where it flags first-message-from-this-sender", () => {
		assert.equal(selectSenderTrustVariant("unknown", "md"), "unknown-pill");
	});
});

describe("SenderTrustIndicator", () => {
	it("renders the VIP sparkles", () => {
		const html = renderToString(
			createElement(SenderTrustIndicator, { senderTrust: "vip" }),
		);
		assert.match(html, /aria-label="VIP sender"/);
	});

	it("renders the new-sender pill only at md", () => {
		assert.match(
			renderToString(
				createElement(SenderTrustIndicator, {
					senderTrust: "unknown",
					size: "md",
				}),
			),
			/First message from this sender/,
		);
		assert.equal(
			renderToString(
				createElement(SenderTrustIndicator, {
					senderTrust: "unknown",
					size: "sm",
				}),
			),
			"",
		);
	});

	it("renders nothing for wellknown", () => {
		assert.equal(
			renderToString(
				createElement(SenderTrustIndicator, { senderTrust: "wellknown" }),
			),
			"",
		);
	});
});
