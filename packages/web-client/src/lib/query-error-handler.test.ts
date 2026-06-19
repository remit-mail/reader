import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError } from "./api";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";
import { handleQueryError } from "./query-error-handler";

afterEach(() => {
	__resetFatalError();
});

describe("handleQueryError (global React Query error sink)", () => {
	it("escalates a first-party 5xx through reportFatalError", () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));

		handleQueryError(new ApiError("internal", 500));

		assert.deepEqual(seen, ["internal"]);
	});

	it("does NOT escalate an expected 404", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		handleQueryError(new ApiError("not found", 404));

		assert.equal(escalated, false);
	});

	it("does NOT escalate an aborted request", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		const abort = new Error("aborted");
		abort.name = "AbortError";
		handleQueryError(abort);

		assert.equal(escalated, false);
	});
});
