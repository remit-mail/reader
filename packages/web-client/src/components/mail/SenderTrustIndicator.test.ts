import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { selectSenderTrustVariant } from "./SenderTrustIndicator.js";

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
