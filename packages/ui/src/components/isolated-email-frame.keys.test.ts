import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isForwardableKey } from "./isolated-email-frame.js";

describe("isForwardableKey", () => {
	it("forwards the keys that move around the app", () => {
		for (const key of [
			"j",
			"k",
			"g",
			"x",
			"r",
			"#",
			"Enter",
			"Escape",
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
		]) {
			assert.equal(isForwardableKey(key), true, key);
		}
	});

	it("keeps destructive keys inside the message body", () => {
		// The replayed event carries no focused control, so the app routes what it
		// recognises straight at the message list. Backspace while reading must not
		// become a delete of the row behind the reader.
		assert.equal(isForwardableKey("Backspace"), false);
		assert.equal(isForwardableKey("Delete"), false);
	});

	it("keeps Space inside the message body", () => {
		// Space belongs to reading the email, not to selecting rows behind it.
		assert.equal(isForwardableKey(" "), false);
	});

	it("does not forward unknown named keys", () => {
		assert.equal(isForwardableKey("F5"), false);
		assert.equal(isForwardableKey("Tab"), false);
		assert.equal(isForwardableKey("PageDown"), false);
	});
});
