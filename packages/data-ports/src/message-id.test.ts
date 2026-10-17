import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bareMessageId, wireMessageId } from "./message-id.js";

describe("bareMessageId", () => {
	it("takes every surrounding bracket and space off", () => {
		for (const spelling of [
			"x@remit.test",
			"<x@remit.test>",
			"<<x@remit.test>>",
			"  <<<x@remit.test>>> ",
		]) {
			assert.equal(bareMessageId(spelling), "x@remit.test");
		}
	});
});

describe("wireMessageId", () => {
	it("wraps a doubled id in exactly one pair of brackets", () => {
		assert.equal(wireMessageId("<<x@remit.test>>"), "<x@remit.test>");
		assert.equal(wireMessageId("x@remit.test"), "<x@remit.test>");
	});
});
