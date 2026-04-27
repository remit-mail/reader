import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	describeOutboxStatus,
	isOutboxListRow,
	isUnsendableStatus,
} from "./outbox-status.js";

describe("describeOutboxStatus", () => {
	test("returns null for draft", () => {
		assert.equal(describeOutboxStatus("draft"), null);
	});

	test("blocked is rendered with a warning tone, not success", () => {
		const desc = describeOutboxStatus("blocked");
		assert.ok(desc);
		assert.equal(desc.tone, "warning");
		assert.equal(desc.label, "Blocked");
	});

	test("sent is success tone", () => {
		const desc = describeOutboxStatus("sent");
		assert.ok(desc);
		assert.equal(desc.tone, "success");
		assert.equal(desc.label, "Sent");
	});

	test("failed is error tone (distinct from blocked)", () => {
		const desc = describeOutboxStatus("failed");
		assert.ok(desc);
		assert.equal(desc.tone, "error");
		assert.notEqual(desc.tone, describeOutboxStatus("blocked")?.tone);
	});
});

describe("isUnsendableStatus", () => {
	test("sent must NOT be flagged as unsendable — never show error subtitle on success (issue #192)", () => {
		assert.equal(isUnsendableStatus("sent"), false);
	});

	test("failed and blocked are unsendable", () => {
		assert.equal(isUnsendableStatus("failed"), true);
		assert.equal(isUnsendableStatus("blocked"), true);
	});

	test("queued and sending are not unsendable", () => {
		assert.equal(isUnsendableStatus("queued"), false);
		assert.equal(isUnsendableStatus("sending"), false);
	});
});

describe("isOutboxListRow", () => {
	test("hides draft and sent rows", () => {
		assert.equal(isOutboxListRow("draft"), false);
		assert.equal(isOutboxListRow("sent"), false);
	});

	test("shows queued, sending, failed, blocked", () => {
		assert.equal(isOutboxListRow("queued"), true);
		assert.equal(isOutboxListRow("sending"), true);
		assert.equal(isOutboxListRow("failed"), true);
		assert.equal(isOutboxListRow("blocked"), true);
	});
});
