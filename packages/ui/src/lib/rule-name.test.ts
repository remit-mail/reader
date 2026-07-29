import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestRuleName } from "./rule-name.js";

describe("suggestRuleName", () => {
	it("names the match and its destination when it knows both", () => {
		assert.equal(
			suggestRuleName({ match: "Your receipt", folder: "Receipts" }),
			"Your receipt → Receipts",
		);
	});

	it("falls back through match, then sender, then destination", () => {
		assert.equal(
			suggestRuleName({ match: "Your receipt" }),
			"Mail matching Your receipt",
		);
		assert.equal(
			suggestRuleName({ sender: "Booking.com" }),
			"Mail from Booking.com",
		);
		assert.equal(suggestRuleName({ folder: "Travel" }), "Mail to Travel");
	});

	it("suggests nothing when it knows nothing", () => {
		assert.equal(suggestRuleName({}), "");
	});
});
