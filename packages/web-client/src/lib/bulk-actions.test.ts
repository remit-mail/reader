import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BULK_ACTION_CHUNK_SIZE,
	type BulkActionTarget,
	chunkIds,
	chunkTargets,
	type FetchIdsPageResult,
	honestProgress,
	runChunkedAction,
	runPredicateAction,
} from "./bulk-actions.js";

const ids = (count: number, prefix = "m"): string[] =>
	Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** Ids from one account, as a materialized selection hands them over. */
const targets = (
	count: number,
	accountId: string | undefined = undefined,
	prefix = "m",
): BulkActionTarget[] => ids(count, prefix).map((id) => ({ id, accountId }));

describe("chunkIds", () => {
	test("empty input yields no chunks", () => {
		assert.deepEqual(chunkIds([]), []);
	});

	test("exactly one chunk's worth stays a single chunk", () => {
		const got = chunkIds(ids(BULK_ACTION_CHUNK_SIZE));
		assert.equal(got.length, 1);
		assert.equal(got[0].length, BULK_ACTION_CHUNK_SIZE);
	});

	test("one over the boundary spills a second chunk of one", () => {
		const got = chunkIds(ids(BULK_ACTION_CHUNK_SIZE + 1));
		assert.equal(got.length, 2);
		assert.equal(got[0].length, BULK_ACTION_CHUNK_SIZE);
		assert.equal(got[1].length, 1);
	});

	test("preserves order across chunk boundaries", () => {
		const input = ids(BULK_ACTION_CHUNK_SIZE + 5);
		const got = chunkIds(input).flat();
		assert.deepEqual(got, input);
	});

	test("a custom size chunks accordingly", () => {
		assert.deepEqual(chunkIds(["a", "b", "c", "d", "e"], 2), [
			["a", "b"],
			["c", "d"],
			["e"],
		]);
	});
});

describe("chunkTargets", () => {
	// Regression for #872: the bulk endpoints reject a batch spanning accounts
	// before applying any of it, and the brief and Flagged both span accounts.
	test("never puts two accounts in one chunk", () => {
		assert.deepEqual(
			chunkTargets(
				[
					{ id: "a1", accountId: "acct-a" },
					{ id: "b1", accountId: "acct-b" },
					{ id: "a2", accountId: "acct-a" },
				],
				100,
			),
			[["a1", "a2"], ["b1"]],
		);
	});

	test("chunks each account by size on its own", () => {
		assert.deepEqual(
			chunkTargets(
				[
					{ id: "a1", accountId: "acct-a" },
					{ id: "a2", accountId: "acct-a" },
					{ id: "a3", accountId: "acct-a" },
					{ id: "b1", accountId: "acct-b" },
				],
				2,
			),
			[["a1", "a2"], ["a3"], ["b1"]],
		);
	});

	test("targets with no account keep their place in the run as a group of their own", () => {
		assert.deepEqual(
			chunkTargets(
				[
					{ id: "u1", accountId: undefined },
					{ id: "a1", accountId: "acct-a" },
					{ id: "u2", accountId: undefined },
				],
				100,
			),
			[["u1", "u2"], ["a1"]],
		);
	});

	test("a single-account selection is one run of chunks, as before", () => {
		const got = chunkTargets(targets(BULK_ACTION_CHUNK_SIZE + 1, "acct-a"));
		assert.equal(got.length, 2);
		assert.equal(got[0].length, BULK_ACTION_CHUNK_SIZE);
	});

	test("empty input yields no chunks", () => {
		assert.deepEqual(chunkTargets([]), []);
	});
});

describe("runChunkedAction", () => {
	const neverCancelled = () => false;
	const noopProgress = () => undefined;

	test("zero ids does nothing and reports done=0", async () => {
		const calls: string[][] = [];
		const outcome = await runChunkedAction(
			[],
			async (chunk) => {
				calls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.deepEqual(outcome, {
			done: 0,
			failedIds: [],
			cancelled: false,
		});
		assert.equal(calls.length, 0);
	});

	test("sequences one call per 100-id chunk, in order", async () => {
		const input = targets(BULK_ACTION_CHUNK_SIZE + 1);
		const calls: string[][] = [];
		const outcome = await runChunkedAction(
			input,
			async (chunk) => {
				calls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].length, BULK_ACTION_CHUNK_SIZE);
		assert.equal(calls[1].length, 1);
		assert.equal(outcome.done, input.length);
		assert.deepEqual(outcome.failedIds, []);
	});

	test("a returned batch counts every id in it as accepted", async () => {
		const input = targets(5);
		const outcome = await runChunkedAction(
			input,
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.done, input.length);
		assert.deepEqual(outcome.failedIds, []);
	});

	test("cancelling mid-run folds every unreached chunk into failedIds", async () => {
		const input = targets(BULK_ACTION_CHUNK_SIZE * 3);
		let calls = 0;
		let cancelled = false;
		const outcome = await runChunkedAction(
			input,
			async (chunk) => {
				calls++;
				if (calls === 1) cancelled = true; // cancel after the first chunk lands
				return { successCount: chunk.length, failureCount: 0 };
			},
			() => undefined,
			() => cancelled,
		);
		assert.equal(outcome.cancelled, true);
		assert.equal(calls, 1);
		assert.equal(outcome.done, BULK_ACTION_CHUNK_SIZE);
		// The two chunks never attempted come back as not-yet-deleted.
		assert.equal(outcome.failedIds.length, BULK_ACTION_CHUNK_SIZE * 2);
	});

	test("an infra failure mid-run stops the run and reports the error", async () => {
		const input = targets(BULK_ACTION_CHUNK_SIZE * 2);
		const boom = new Error("network blip");
		const outcome = await runChunkedAction(
			input,
			async () => {
				throw boom;
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.error, boom);
		assert.equal(outcome.done, 0);
		assert.equal(outcome.failedIds.length, input.length);
	});

	test("a selection spanning accounts is sent as one batch per account", async () => {
		const calls: string[][] = [];
		const outcome = await runChunkedAction(
			[
				{ id: "a1", accountId: "acct-a" },
				{ id: "b1", accountId: "acct-b" },
				{ id: "a2", accountId: "acct-a" },
			],
			async (chunk) => {
				calls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.deepEqual(calls, [["a1", "a2"], ["b1"]]);
		assert.equal(outcome.done, 3);
		assert.deepEqual(outcome.failedIds, []);
	});

	test("progress counts toward the whole selection, not toward each account", async () => {
		const seen: { done: number; total: number }[] = [];
		await runChunkedAction(
			[
				{ id: "a1", accountId: "acct-a" },
				{ id: "b1", accountId: "acct-b" },
			],
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			(p) => seen.push(p),
			neverCancelled,
		);
		assert.deepEqual(seen, [
			{ done: 1, total: 2 },
			{ done: 2, total: 2 },
		]);
	});

	test("cancelling at an account boundary hands back the accounts never reached", async () => {
		let cancelled = false;
		const outcome = await runChunkedAction(
			[
				{ id: "a1", accountId: "acct-a" },
				{ id: "b1", accountId: "acct-b" },
				{ id: "c1", accountId: "acct-c" },
			],
			async (chunk) => {
				cancelled = true;
				return { successCount: chunk.length, failureCount: 0 };
			},
			() => undefined,
			() => cancelled,
		);
		assert.equal(outcome.cancelled, true);
		assert.equal(outcome.done, 1);
		assert.deepEqual(outcome.failedIds, ["b1", "c1"]);
	});

	test("one account's batch failing leaves the rest unsent and says how far it got", async () => {
		const boom = new Error("500");
		const outcome = await runChunkedAction(
			[
				{ id: "a1", accountId: "acct-a" },
				{ id: "b1", accountId: "acct-b" },
			],
			async (chunk) => {
				if (chunk[0] === "b1") throw boom;
				return { successCount: chunk.length, failureCount: 0 };
			},
			() => undefined,
			neverCancelled,
		);
		assert.equal(outcome.error, boom);
		assert.equal(outcome.done, 1);
		assert.deepEqual(outcome.failedIds, ["b1"]);
	});

	test("the accounts behind a failed one are handed back whole, never half-sent", async () => {
		const calls: string[][] = [];
		const outcome = await runChunkedAction(
			[
				{ id: "a1", accountId: "acct-a" },
				{ id: "b1", accountId: "acct-b" },
				{ id: "c1", accountId: "acct-c" },
			],
			async (chunk) => {
				calls.push(chunk);
				throw new Error("auth expired");
			},
			() => undefined,
			neverCancelled,
		);
		// The run stops where it threw rather than trying the accounts behind it:
		// what it hands back is exactly what is still untouched, which is what a
		// retry re-sends.
		assert.deepEqual(calls, [["a1"]]);
		assert.equal(outcome.done, 0);
		assert.deepEqual(outcome.failedIds, ["a1", "b1", "c1"]);
	});

	test("reports progress after each chunk", async () => {
		const input = targets(BULK_ACTION_CHUNK_SIZE + 1);
		const progressCalls: { done: number; total: number }[] = [];
		await runChunkedAction(
			input,
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			(p) => progressCalls.push(p),
			neverCancelled,
		);
		assert.deepEqual(progressCalls, [
			{ done: BULK_ACTION_CHUNK_SIZE, total: input.length },
			{ done: input.length, total: input.length },
		]);
	});
});

describe("runPredicateAction", () => {
	const neverCancelled = () => false;
	const noopProgress = () => undefined;

	/** Builds a paged fixture: `pages[i]` is what the i-th call returns. */
	const pagedFetcher = (pages: FetchIdsPageResult[]) => {
		let call = 0;
		return async (): Promise<FetchIdsPageResult> => {
			const page = pages[call];
			call++;
			return page;
		};
	};

	test("zero matches deletes nothing", async () => {
		const fetch = pagedFetcher([{ ids: [] }]);
		const outcome = await runPredicateAction(
			fetch,
			0,
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			noopProgress,
			neverCancelled,
		);
		assert.deepEqual(outcome, { done: 0, failedIds: [], cancelled: false });
	});

	test("exactly 100 matches — a page size's worth — resolves in a single page with no continuation", async () => {
		const fetch = pagedFetcher([{ ids: ids(BULK_ACTION_CHUNK_SIZE) }]);
		const deleteCalls: string[][] = [];
		const outcome = await runPredicateAction(
			fetch,
			BULK_ACTION_CHUNK_SIZE,
			async (chunk) => {
				deleteCalls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(deleteCalls.length, 1);
		assert.equal(outcome.done, BULK_ACTION_CHUNK_SIZE);
	});

	test("pages until the continuation token is exhausted, one delete call per page", async () => {
		const fetch = pagedFetcher([
			{ ids: ids(100, "a"), continuationToken: "t1" },
			{ ids: ids(50, "b") },
		]);
		const deleteCalls: string[][] = [];
		const outcome = await runPredicateAction(
			fetch,
			150,
			async (chunk) => {
				deleteCalls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(deleteCalls.length, 2);
		assert.equal(outcome.done, 150);
	});

	test("a list refresh mid-run that adds and removes rows just changes what later pages contain — the predicate resolves fresh, never a stale materialized set", async () => {
		// Page 1 sees the original matches. Page 2 (fetched only after page 1's
		// batch has already been deleted) reflects new mail having arrived and
		// one previously-seen id having been filed elsewhere mid-run.
		const fetch = pagedFetcher([
			{ ids: ["a", "b"], continuationToken: "t1" },
			{ ids: ["new-c", "d"] }, // "b" is gone (filed away), "new-c" just arrived
		]);
		const deleteCalls: string[][] = [];
		const outcome = await runPredicateAction(
			fetch,
			4,
			async (chunk) => {
				deleteCalls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.deepEqual(deleteCalls, [
			["a", "b"],
			["new-c", "d"],
		]);
		assert.equal(outcome.done, 4);
	});

	test("cancelling mid-delete stops paging without inventing failedIds for unfetched pages", async () => {
		let fetchCalls = 0;
		let cancelled = false;
		const fetch = async (): Promise<FetchIdsPageResult> => {
			fetchCalls++;
			return { ids: ["a", "b"], continuationToken: "more" };
		};
		const outcome = await runPredicateAction(
			fetch,
			1000,
			async (chunk) => {
				cancelled = true; // cancel takes effect on the next loop iteration
				return { successCount: chunk.length, failureCount: 0 };
			},
			() => undefined,
			() => cancelled,
		);
		assert.equal(outcome.cancelled, true);
		assert.equal(fetchCalls, 1);
		assert.equal(outcome.done, 2);
		assert.deepEqual(outcome.failedIds, []);
	});

	test("an infra failure while fetching a page stops the run and reports the error", async () => {
		const boom = new Error("timed out");
		const fetch = async (): Promise<FetchIdsPageResult> => {
			throw boom;
		};
		const outcome = await runPredicateAction(
			fetch,
			100,
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.error, boom);
		assert.equal(outcome.done, 0);
	});

	test("an infra failure from the delete call itself stops the run and reports the error", async () => {
		const boom = new Error("500");
		const fetch = pagedFetcher([{ ids: ["a"] }]);
		const outcome = await runPredicateAction(
			fetch,
			1,
			async () => {
				throw boom;
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.error, boom);
	});
});

describe("honestProgress", () => {
	// Regression for #109: the count and `runPredicateAction` resolve the same
	// predicate independently, so the delete can outrun the frozen `total` it
	// started with when the result set grows in between.
	test("leaves an on-track progress reading untouched", () => {
		assert.deepEqual(honestProgress({ done: 50, total: 100 }), {
			done: 50,
			total: 100,
		});
	});

	test("widens total to match done once done overtakes it, instead of reading past 100%", () => {
		assert.deepEqual(honestProgress({ done: 1340, total: 1284 }), {
			done: 1340,
			total: 1340,
		});
	});

	test("done equal to total stays put", () => {
		assert.deepEqual(honestProgress({ done: 100, total: 100 }), {
			done: 100,
			total: 100,
		});
	});

	test("never reports a total below zero-progress done", () => {
		assert.deepEqual(honestProgress({ done: 0, total: 0 }), {
			done: 0,
			total: 0,
		});
	});
});
