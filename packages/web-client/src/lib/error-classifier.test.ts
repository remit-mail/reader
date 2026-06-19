import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "./api";
import { getErrorStatus, isFatalServerError } from "./error-classifier";

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

describe("isFatalServerError", () => {
	it("is true for any 5xx from a first-party endpoint", () => {
		assert.equal(isFatalServerError(new ApiError("boom", 500)), true);
		assert.equal(isFatalServerError(new ApiError("boom", 502)), true);
		assert.equal(isFatalServerError(new ApiError("boom", 503)), true);
		assert.equal(isFatalServerError({ status: 599 }), true);
	});

	it("is false for expected 4xx (404 no-data, 401/403 auth, 409/422/429)", () => {
		assert.equal(isFatalServerError(new ApiError("not found", 404)), false);
		assert.equal(isFatalServerError(new ApiError("unauthorized", 401)), false);
		assert.equal(isFatalServerError(new ApiError("forbidden", 403)), false);
		assert.equal(isFatalServerError(new ApiError("conflict", 409)), false);
		assert.equal(isFatalServerError(new ApiError("invalid", 422)), false);
		assert.equal(isFatalServerError(new ApiError("rate", 429)), false);
	});

	it("is false for an empty result (undefined / null — not an error)", () => {
		assert.equal(isFatalServerError(undefined), false);
		assert.equal(isFatalServerError(null), false);
	});

	it("is false for an aborted / cancelled request", () => {
		const abort = new Error("aborted");
		abort.name = "AbortError";
		assert.equal(isFatalServerError(abort), false);
	});

	it("is NOT fatal for a statusless transport/network failure (offline blip, not a proven 5xx)", () => {
		// Headline regression: a `TypeError: Failed to fetch` from a wifi drop,
		// tab wake, captive portal, or background refetch must never take over the
		// screen behind a reload-only overlay. No HTTP status ⇒ not a proven
		// first-party 5xx ⇒ soft; React Query's reconnect/retry recovers it.
		assert.equal(isFatalServerError(new TypeError("Failed to fetch")), false);
		assert.equal(isFatalServerError(new Error("network down")), false);
	});

	it("is NOT fatal for a statusless auth failure (handled by Amplify/redirect, never the overlay)", () => {
		assert.equal(isFatalServerError(new Error("No current user")), false);
	});
});
