import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Mutation, Query } from "@tanstack/react-query";
import { ApiError } from "./api";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";
import { NetworkError } from "./network-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "./query-error-handler";

const fakeQuery = (
	meta?: Record<string, unknown>,
	dataUpdatedAt = 0,
	dataUpdateCount = 0,
): Query<unknown, unknown, unknown> =>
	({ meta, state: { dataUpdatedAt, dataUpdateCount } }) as unknown as Query<
		unknown,
		unknown,
		unknown
	>;

const fakeMutation = (
	meta?: Record<string, unknown>,
): Mutation<unknown, unknown, unknown> =>
	({ meta }) as unknown as Mutation<unknown, unknown, unknown>;

const abortError = (): Error => {
	const error = new Error("aborted");
	error.name = "AbortError";
	return error;
};

const escalations = (): string[] => {
	const seen: string[] = [];
	subscribeFatalError((fatal) => seen.push(fatal.message));
	return seen;
};

afterEach(() => {
	__resetFatalError();
});

describe("handleQueryCacheError (fail-fast contract #1059)", () => {
	it("escalates a 5xx that breaks the INITIAL load", () => {
		const seen = escalations();
		handleQueryCacheError(
			new ApiError("internal", 500),
			fakeQuery(undefined, 0),
		);
		assert.deepEqual(seen, ["internal"]);
	});

	it("escalates a 5xx on a background REFETCH (the deleted dataUpdatedAt guard — the headline bug)", () => {
		const seen = escalations();
		// dataUpdatedAt !== 0 used to swallow this (PR #758). It must now escalate.
		handleQueryCacheError(
			new ApiError("internal", 500),
			fakeQuery(undefined, 123456),
		);
		assert.deepEqual(seen, ["internal"]);
	});

	it("escalates a 5xx EVEN when the query is marked meta.softError (rule 2 wins)", () => {
		const seen = escalations();
		handleQueryCacheError(
			new ApiError("internal", 500),
			fakeQuery({ softError: true }, 123456),
		);
		assert.deepEqual(seen, ["internal"]);
	});

	it("escalates a 4xx by DEFAULT (no opt-out)", () => {
		const seen = escalations();
		handleQueryCacheError(new ApiError("not found", 404), fakeQuery());
		assert.deepEqual(seen, ["not found"]);
	});

	it("does NOT escalate a 4xx the query opted out of via meta.softError", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		handleQueryCacheError(
			new ApiError("not found", 404),
			fakeQuery({ softError: true }),
		);
		assert.equal(escalated, false);
	});

	it("does NOT escalate an aborted request", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		handleQueryCacheError(abortError(), fakeQuery());
		assert.equal(escalated, false);
	});

	it("does NOT escalate a network blip tagged at the fetch boundary", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		handleQueryCacheError(
			new NetworkError(new TypeError("Failed to fetch")),
			fakeQuery(),
		);
		assert.equal(escalated, false);
	});
});

describe("handleQueryCacheError — background-poll streaks (#225)", () => {
	const poll = () => fakeQuery({ backgroundPoll: true }, 123456, 1);
	const blip = () => new ApiError("apisix unreachable", 502);

	it("does NOT escalate the first transient 5xx on a background poll", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		handleQueryCacheError(blip(), poll());
		assert.equal(escalated, false);
	});

	it("escalates once the same poll fails three times in a row", () => {
		const seen = escalations();
		// One stable Query object across polls — the streak accrues on it. Its
		// success count never advances (every fetch fails), so nothing resets it.
		const query = poll();
		handleQueryCacheError(blip(), query);
		handleQueryCacheError(blip(), query);
		assert.deepEqual(seen, [], "quiet through the first two failures");
		handleQueryCacheError(blip(), query);
		assert.deepEqual(seen, ["apisix unreachable"]);
	});

	it("resets the streak when a success lands between failures", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		// Mutable success count: a poll that recovers advances dataUpdateCount,
		// which breaks the consecutive-failure streak.
		const state = { dataUpdatedAt: 123456, dataUpdateCount: 1 };
		const query = {
			meta: { backgroundPoll: true },
			state,
		} as unknown as Query<unknown, unknown, unknown>;

		handleQueryCacheError(blip(), query); // streak 1
		handleQueryCacheError(blip(), query); // streak 2
		state.dataUpdateCount = 2; // a poll succeeded
		handleQueryCacheError(blip(), query); // streak resets to 1
		handleQueryCacheError(blip(), query); // streak 2 — never reaches 3

		assert.equal(escalated, false);
	});
});

describe("handleMutationCacheError (fail-fast contract #1059)", () => {
	it("escalates a mutation 5xx", () => {
		const seen = escalations();
		handleMutationCacheError(
			new ApiError("mutation blew up", 503),
			undefined,
			undefined,
			fakeMutation(),
		);
		assert.deepEqual(seen, ["mutation blew up"]);
	});

	it("escalates a mutation 4xx by DEFAULT", () => {
		const seen = escalations();
		handleMutationCacheError(
			new ApiError("conflict", 409),
			undefined,
			undefined,
			fakeMutation(),
		);
		assert.deepEqual(seen, ["conflict"]);
	});

	it("does NOT escalate a mutation 4xx marked meta.softError", () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		handleMutationCacheError(
			new ApiError("conflict", 409),
			undefined,
			undefined,
			fakeMutation({ softError: true }),
		);
		assert.equal(escalated, false);
	});
});
