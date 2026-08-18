import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	describeOutboxStatus,
	isOutboxListRow,
	showsLastError,
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

	test("unfiled says the message was sent but not filed", () => {
		const desc = describeOutboxStatus("unfiled");
		assert.ok(desc);
		assert.equal(desc.tone, "warning");
		assert.match(desc.label, /not filed/);
	});

	test("failed is error tone (distinct from blocked)", () => {
		const desc = describeOutboxStatus("failed");
		assert.ok(desc);
		assert.equal(desc.tone, "error");
		assert.notEqual(desc.tone, describeOutboxStatus("blocked")?.tone);
	});
});

describe("showsLastError", () => {
	test("sent must NOT surface an error — never show an error subtitle on success (issue #192)", () => {
		assert.equal(showsLastError("sent"), false);
	});

	test("failed and blocked surface their error", () => {
		assert.equal(showsLastError("failed"), true);
		assert.equal(showsLastError("blocked"), true);
	});

	test("unfiled surfaces its reason — the row exists only to carry it", () => {
		assert.equal(showsLastError("unfiled"), true);
	});

	test("queued and sending carry no error", () => {
		assert.equal(showsLastError("queued"), false);
		assert.equal(showsLastError("sending"), false);
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

	test("keeps an unfiled row listed — it is the only copy the user has", () => {
		assert.equal(isOutboxListRow("unfiled"), true);
	});
});
