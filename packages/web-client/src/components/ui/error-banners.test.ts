import assert from "node:assert";
import { describe, test } from "node:test";
import {
	appendBanner,
	buildEntry,
	dismissBanner,
	type ErrorBannerEntry,
	formatErrorDetail,
	isMessageNotFoundError,
} from "./error-banners.js";

const make = (
	overrides: Partial<ErrorBannerEntry> & { id: string },
): ErrorBannerEntry => ({
	severity: "error",
	title: "default",
	detail: undefined,
	createdAt: 0,
	...overrides,
});

describe("buildEntry", () => {
	test("defaults to error severity", () => {
		const entry = buildEntry({ title: "boom" }, "id-1", 1000);
		assert.equal(entry.severity, "error");
		assert.equal(entry.title, "boom");
		assert.equal(entry.id, "id-1");
		assert.equal(entry.createdAt, 1000);
	});

	test("preserves explicit severity and detail", () => {
		const entry = buildEntry(
			{ severity: "warning", title: "watch", detail: "context" },
			"id-2",
			2000,
		);
		assert.equal(entry.severity, "warning");
		assert.equal(entry.detail, "context");
	});
});

describe("appendBanner", () => {
	test("adds an entry at the end of the stack", () => {
		const a = make({ id: "1", title: "first" });
		const b = make({ id: "2", title: "second" });
		const got = appendBanner([a], b);
		assert.deepStrictEqual(
			got.map((e) => e.id),
			["1", "2"],
		);
	});

	test("dedupes entries with the same severity, title and detail", () => {
		const a = make({
			id: "1",
			title: "Couldn't mark as read",
			detail: "Network error",
		});
		const b = make({
			id: "2",
			title: "Couldn't mark as read",
			detail: "Network error",
		});
		const got = appendBanner([a], b);
		assert.equal(got.length, 1);
		assert.equal(got[0]?.id, "2");
	});

	test("keeps differing detail as separate banners", () => {
		const a = make({
			id: "1",
			title: "Couldn't mark as read",
			detail: "Network error",
		});
		const b = make({
			id: "2",
			title: "Couldn't mark as read",
			detail: "Server error",
		});
		const got = appendBanner([a], b);
		assert.equal(got.length, 2);
	});

	test("caps the stack at 5 by dropping the oldest", () => {
		let stack: ErrorBannerEntry[] = [];
		for (let i = 0; i < 7; i++) {
			stack = appendBanner(
				stack,
				make({ id: `${i}`, title: `t${i}`, createdAt: i }),
			);
		}
		assert.equal(stack.length, 5);
		assert.deepStrictEqual(
			stack.map((e) => e.id),
			["2", "3", "4", "5", "6"],
		);
	});
});

describe("dismissBanner", () => {
	test("removes the matching entry and leaves the rest in order", () => {
		const stack = [make({ id: "1" }), make({ id: "2" }), make({ id: "3" })];
		const got = dismissBanner(stack, "2");
		assert.deepStrictEqual(
			got.map((e) => e.id),
			["1", "3"],
		);
	});

	test("returns the same shape when the id is unknown", () => {
		const stack = [make({ id: "1" })];
		const got = dismissBanner(stack, "nope");
		assert.equal(got.length, 1);
	});
});

describe("formatErrorDetail", () => {
	test("returns the message of an Error", () => {
		assert.equal(formatErrorDetail(new Error("boom")), "boom");
	});

	test("returns a non-empty string as-is", () => {
		assert.equal(formatErrorDetail("nope"), "nope");
	});

	test("returns undefined for empty strings", () => {
		assert.equal(formatErrorDetail(""), undefined);
	});

	test("reads object .message", () => {
		assert.equal(formatErrorDetail({ message: "shape" }), "shape");
	});

	test("returns undefined for null/undefined", () => {
		assert.equal(formatErrorDetail(null), undefined);
		assert.equal(formatErrorDetail(undefined), undefined);
	});

	test("returns undefined when nothing matches", () => {
		assert.equal(formatErrorDetail(42), undefined);
		assert.equal(formatErrorDetail({}), undefined);
	});
});

describe("isMessageNotFoundError (#212)", () => {
	// Regression: clicking a stale inbox row used to hit `describeMessage`
	// and surface the raw "Message not found: <id>" string. The frontend now
	// detects that error shape and shows a "deleted" empty state.

	test("matches the backend's NotFoundError JSON body", () => {
		assert.equal(
			isMessageNotFoundError({
				message: "Message not found: alice-msg-aaaaaaa",
			}),
			true,
		);
	});

	test("matches an Error instance with the same message", () => {
		assert.equal(
			isMessageNotFoundError(new Error("Message not found: bob-msg-aaaaaaa")),
			true,
		);
	});

	test("does not match unrelated errors", () => {
		assert.equal(
			isMessageNotFoundError({ message: "Mailbox not found: x" }),
			false,
		);
		assert.equal(isMessageNotFoundError(new Error("boom")), false);
		assert.equal(isMessageNotFoundError(null), false);
		assert.equal(isMessageNotFoundError(undefined), false);
		assert.equal(isMessageNotFoundError({}), false);
	});
});
