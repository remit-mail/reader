import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteLabelConfirmCopy } from "./label-delete-copy";

describe("deleteLabelConfirmCopy", () => {
	it("names the label with no blast-radius note when no filter uses it", () => {
		const copy = deleteLabelConfirmCopy("Receipts", 0);
		assert.equal(copy.title, 'Delete the "Receipts" label?');
		assert.equal(copy.description, undefined);
	});

	it("names exactly one filter in the singular", () => {
		const copy = deleteLabelConfirmCopy("Receipts", 1);
		assert.match(copy.description ?? "", /1 filter that applies it/);
	});

	it("names several filters in the plural", () => {
		const copy = deleteLabelConfirmCopy("Receipts", 3);
		assert.match(copy.description ?? "", /3 filters that apply it/);
	});
});
