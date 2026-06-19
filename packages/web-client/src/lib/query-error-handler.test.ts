import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Query } from "@tanstack/react-query";
import { ApiError } from "./api";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";
import { handleQueryCacheError, handleQueryError } from "./query-error-handler";

const fakeQuery = (
	dataUpdatedAt: number,
): Query<unknown, unknown, unknown, readonly unknown[]> =>
	({ state: { dataUpdatedAt } }) as unknown as Query<
		unknown,
		unknown,
		unknown,
		readonly unknown[]
	>;

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

	it("does NOT escalate a statusless network blip", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		handleQueryError(new TypeError("Failed to fetch"));

		assert.equal(escalated, false);
	});
});

describe("handleQueryCacheError (initial-load-only escalation)", () => {
	it("escalates a 5xx that breaks the INITIAL load (dataUpdatedAt === 0)", () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));

		handleQueryCacheError(new ApiError("internal", 500), fakeQuery(0));

		assert.deepEqual(seen, ["internal"]);
	});

	it("does NOT escalate a 5xx from a background refetch on already-rendered data", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		handleQueryCacheError(new ApiError("internal", 500), fakeQuery(123456));

		assert.equal(escalated, false);
	});

	it("does NOT escalate a statusless network blip even on initial load", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});

		handleQueryCacheError(new TypeError("Failed to fetch"), fakeQuery(0));

		assert.equal(escalated, false);
	});
});
