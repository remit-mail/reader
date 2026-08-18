import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { offerableAsRecipient } from "./recipient-suggestions";

const setAt = 1;

describe("who the compose picker may offer", () => {
	it("offers a sender carrying no opinion", () => {
		assert.equal(offerableAsRecipient({}), true);
		assert.equal(offerableAsRecipient(undefined), true);
	});

	it("refuses a sender met only on mail in Junk", () => {
		assert.equal(
			offerableAsRecipient({ junkOnly: { value: true, setAt } }),
			false,
		);
	});

	it("refuses a sender the account blocked", () => {
		assert.equal(
			offerableAsRecipient({ blocked: { value: true, setAt } }),
			false,
		);
	});

	it("refuses a blocked sender the search still has to return", () => {
		assert.equal(
			offerableAsRecipient({
				junkOnly: { value: true, setAt },
				blocked: { value: true, setAt },
			}),
			false,
		);
	});

	it("offers a muted sender, which is about notice and not about mail", () => {
		assert.equal(offerableAsRecipient({ muted: { value: true, setAt } }), true);
	});

	it("offers a sender whose mark was cleared", () => {
		assert.equal(
			offerableAsRecipient({ junkOnly: { value: false, setAt } }),
			true,
		);
	});
});
