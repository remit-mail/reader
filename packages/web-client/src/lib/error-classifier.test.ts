import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "./api";
import {
	getErrorStatus,
	hasHttpStatus,
	isAbortError,
	isNetworkError,
	isServerError,
	shouldEscalate,
} from "./error-classifier";

const abortError = (): Error => {
	const error = new Error("aborted");
	error.name = "AbortError";
	return error;
};

describe("getErrorStatus", () => {
	it("reads status off an ApiError", () => {
		assert.equal(getErrorStatus(new ApiError("boom", 503)), 503);
	});

	it("reads a numeric status off a plain object", () => {
		assert.equal(getErrorStatus({ status: 500 }), 500);
		assert.equal(getErrorStatus({ statusCode: 404 }), 404);
	});

	it("returns undefined when no status is present", () => {
		assert.equal(getErrorStatus(new Error("network")), undefined);
		assert.equal(getErrorStatus("nope"), undefined);
		assert.equal(getErrorStatus(null), undefined);
	});
});

describe("isServerError", () => {
	it("is true for any 5xx", () => {
		assert.equal(isServerError(new ApiError("boom", 500)), true);
		assert.equal(isServerError(new ApiError("boom", 502)), true);
		assert.equal(isServerError({ status: 599 }), true);
	});

	it("is false for a 4xx", () => {
		assert.equal(isServerError(new ApiError("not found", 404)), false);
		assert.equal(isServerError(new ApiError("forbidden", 403)), false);
	});

	it("is false for a statusless error", () => {
		assert.equal(isServerError(new TypeError("Failed to fetch")), false);
		assert.equal(isServerError(undefined), false);
	});
});

describe("hasHttpStatus", () => {
	it("is true when the error carries a status", () => {
		assert.equal(hasHttpStatus(new ApiError("boom", 500)), true);
		assert.equal(hasHttpStatus({ statusCode: 404 }), true);
	});

	it("is false for a statusless error", () => {
		assert.equal(hasHttpStatus(new TypeError("Failed to fetch")), false);
		assert.equal(hasHttpStatus(null), false);
	});
});

describe("isAbortError", () => {
	it("is true for an AbortError", () => {
		assert.equal(isAbortError(abortError()), true);
	});

	it("is false for anything else", () => {
		assert.equal(isAbortError(new ApiError("boom", 500)), false);
		assert.equal(isAbortError(new TypeError("Failed to fetch")), false);
	});
});

describe("isNetworkError", () => {
	it("is true for a statusless transport failure", () => {
		assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
		assert.equal(isNetworkError(new Error("network down")), true);
	});

	it("is false for an aborted request (its own category)", () => {
		assert.equal(isNetworkError(abortError()), false);
	});

	it("is false when the error carries a status", () => {
		assert.equal(isNetworkError(new ApiError("boom", 500)), false);
		assert.equal(isNetworkError(new ApiError("not found", 404)), false);
	});
});

describe("shouldEscalate (the fail-fast decision table — #1059)", () => {
	it("escalates a 5xx by default", () => {
		assert.equal(shouldEscalate(new ApiError("boom", 500)), true);
		assert.equal(shouldEscalate(new ApiError("boom", 503)), true);
	});

	it("escalates a 5xx EVEN when the call site marked it soft (rule 2 wins)", () => {
		assert.equal(
			shouldEscalate(new ApiError("boom", 500), { softError: true }),
			true,
		);
	});

	it("escalates a 4xx by DEFAULT (no opt-out)", () => {
		assert.equal(shouldEscalate(new ApiError("not found", 404)), true);
		assert.equal(shouldEscalate(new ApiError("forbidden", 403)), true);
	});

	it("does NOT escalate a 4xx the call site opted out of via meta.softError", () => {
		assert.equal(
			shouldEscalate(new ApiError("not found", 404), { softError: true }),
			false,
		);
	});

	it("does NOT escalate an aborted/cancelled request", () => {
		assert.equal(shouldEscalate(abortError()), false);
	});

	it("does NOT escalate a statusless network/offline blip", () => {
		assert.equal(shouldEscalate(new TypeError("Failed to fetch")), false);
		assert.equal(shouldEscalate(new Error("network down")), false);
	});

	it("a statusless error is soft regardless of meta", () => {
		assert.equal(
			shouldEscalate(new TypeError("Failed to fetch"), { softError: false }),
			false,
		);
	});
});
