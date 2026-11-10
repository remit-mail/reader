import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SenderTrust } from "@remit/domain-enums";
import { hasOffRowCriteria } from "./filterThreadCriteria.js";

describe("hasOffRowCriteria", () => {
	it("is false for an empty criteria object", () => {
		assert.equal(hasOffRowCriteria({}), false);
	});

	it("is false for empty arrays", () => {
		assert.equal(hasOffRowCriteria({ senderTrust: [] }), false);
	});

	it("is true when any criterion is set", () => {
		assert.equal(hasOffRowCriteria({ senderTrust: [SenderTrust.Vip] }), true);
		assert.equal(hasOffRowCriteria({ dkimMismatch: false }), true);
	});
});
