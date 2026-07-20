import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BULK_DELETE_CHUNK_SIZE,
	chunkIds,
	countMatches,
	type DeleteBatchResult,
	type FetchIdsPageResult,
	resolveSelectionAfterDelete,
	runChunkedDelete,
	runPredicateDelete,
} from "./bulk-delete.js";

const ids = (count: number, prefix = "m"): string[] =>
	Array.from({ length: count }, (_, i) => `${prefix}${i}`);

describe("chunkIds", () => {
	test("empty input yields no chunks", () => {
		assert.deepEqual(chunkIds([]), []);
	});

	test("exactly one chunk's worth stays a single chunk", () => {
		const got = chunkIds(ids(BULK_DELETE_CHUNK_SIZE));
		assert.equal(got.length, 1);
		assert.equal(got[0].length, BULK_DELETE_CHUNK_SIZE);
	});

	test("one over the boundary spills a second chunk of one", () => {
		const got = chunkIds(ids(BULK_DELETE_CHUNK_SIZE + 1));
		assert.equal(got.length, 2);
		assert.equal(got[0].length, BULK_DELETE_CHUNK_SIZE);
		assert.equal(got[1].length, 1);
	});

	test("preserves order across chunk boundaries", () => {
		const input = ids(BULK_DELETE_CHUNK_SIZE + 5);
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

describe("runChunkedDelete", () => {
	const neverCancelled = () => false;
	const noopProgress = () => undefined;

	test("zero ids does nothing and reports done=0", async () => {
		const calls: string[][] = [];
		const outcome = await runChunkedDelete(
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
		const input = ids(BULK_DELETE_CHUNK_SIZE + 1);
		const calls: string[][] = [];
		const outcome = await runChunkedDelete(
			input,
			async (chunk) => {
				calls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].length, BULK_DELETE_CHUNK_SIZE);
		assert.equal(calls[1].length, 1);
		assert.equal(outcome.done, input.length);
		assert.deepEqual(outcome.failedIds, []);
	});

	test("the count deleted matches exactly what the batches reported succeeded", async () => {
		const input = ids(5);
		const outcome = await runChunkedDelete(
			input,
			async (chunk) => ({
				successCount: chunk.length - 2,
				failureCount: 2,
				failedIds: chunk.slice(0, 2),
			}),
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.done, 3);
		assert.deepEqual(outcome.failedIds, input.slice(0, 2));
	});

	test("partial failure: failed ids are reported, not rolled into done", async () => {
		const input = ids(3);
		const outcome = await runChunkedDelete(
			input,
			async (chunk) => ({
				successCount: 2,
				failureCount: 1,
				failedIds: [chunk[1]],
			}),
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.done, 2);
		assert.deepEqual(outcome.failedIds, [input[1]]);
	});

	test("cancelling mid-run folds every unreached chunk into failedIds", async () => {
		const input = ids(BULK_DELETE_CHUNK_SIZE * 3);
		let calls = 0;
		let cancelled = false;
		const outcome = await runChunkedDelete(
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
		assert.equal(outcome.done, BULK_DELETE_CHUNK_SIZE);
		// The two chunks never attempted come back as not-yet-deleted.
		assert.equal(outcome.failedIds.length, BULK_DELETE_CHUNK_SIZE * 2);
	});

	test("an infra failure mid-run stops the run and reports the error", async () => {
		const input = ids(BULK_DELETE_CHUNK_SIZE * 2);
		const boom = new Error("network blip");
		const outcome = await runChunkedDelete(
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

	test("reports progress after each chunk", async () => {
		const input = ids(BULK_DELETE_CHUNK_SIZE + 1);
		const progressCalls: { done: number; total: number }[] = [];
		await runChunkedDelete(
			input,
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			(p) => progressCalls.push(p),
			neverCancelled,
		);
		assert.deepEqual(progressCalls, [
			{ done: BULK_DELETE_CHUNK_SIZE, total: input.length },
			{ done: input.length, total: input.length },
		]);
	});
});

describe("runPredicateDelete", () => {
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
		const outcome = await runPredicateDelete(
			fetch,
			0,
			async (chunk) => ({ successCount: chunk.length, failureCount: 0 }),
			noopProgress,
			neverCancelled,
		);
		assert.deepEqual(outcome, { done: 0, failedIds: [], cancelled: false });
	});

	test("exactly 100 matches — a page size's worth — resolves in a single page with no continuation", async () => {
		const fetch = pagedFetcher([{ ids: ids(BULK_DELETE_CHUNK_SIZE) }]);
		const deleteCalls: string[][] = [];
		const outcome = await runPredicateDelete(
			fetch,
			BULK_DELETE_CHUNK_SIZE,
			async (chunk) => {
				deleteCalls.push(chunk);
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(deleteCalls.length, 1);
		assert.equal(outcome.done, BULK_DELETE_CHUNK_SIZE);
	});

	test("pages until the continuation token is exhausted, one delete call per page", async () => {
		const fetch = pagedFetcher([
			{ ids: ids(100, "a"), continuationToken: "t1" },
			{ ids: ids(50, "b") },
		]);
		const deleteCalls: string[][] = [];
		const outcome = await runPredicateDelete(
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
		const outcome = await runPredicateDelete(
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

	test("partial failure across pages accumulates failedIds without rolling into done", async () => {
		const fetch = pagedFetcher([
			{ ids: ["a", "b"], continuationToken: "t1" },
			{ ids: ["c"] },
		]);
		const outcome = await runPredicateDelete(
			fetch,
			3,
			async (chunk): Promise<DeleteBatchResult> => {
				if (chunk.includes("b")) {
					return { successCount: 1, failureCount: 1, failedIds: ["b"] };
				}
				return { successCount: chunk.length, failureCount: 0 };
			},
			noopProgress,
			neverCancelled,
		);
		assert.equal(outcome.done, 2);
		assert.deepEqual(outcome.failedIds, ["b"]);
	});

	test("cancelling mid-delete stops paging without inventing failedIds for unfetched pages", async () => {
		let fetchCalls = 0;
		let cancelled = false;
		const fetch = async (): Promise<FetchIdsPageResult> => {
			fetchCalls++;
			return { ids: ["a", "b"], continuationToken: "more" };
		};
		const outcome = await runPredicateDelete(
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
		const outcome = await runPredicateDelete(
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
		const outcome = await runPredicateDelete(
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

describe("countMatches", () => {
	const neverCancelled = () => false;

	test("counts across every page until the token is exhausted", async () => {
		let call = 0;
		const pages: FetchIdsPageResult[] = [
			{ ids: ids(500, "a"), continuationToken: "t1" },
			{ ids: ids(500, "b"), continuationToken: "t2" },
			{ ids: ids(412, "c") },
		];
		const fetch = async () => pages[call++];
		const outcome = await countMatches(fetch, () => undefined, neverCancelled);
		assert.deepEqual(outcome, { total: 1412, cancelled: false });
	});

	test("reports a running total after each page", async () => {
		let call = 0;
		const pages: FetchIdsPageResult[] = [
			{ ids: ids(500), continuationToken: "t1" },
			{ ids: ids(300) },
		];
		const fetch = async () => pages[call++];
		const progressCalls: number[] = [];
		await countMatches(fetch, (n) => progressCalls.push(n), neverCancelled);
		assert.deepEqual(progressCalls, [500, 800]);
	});

	test("cancelling mid-count stops paging and reports what it had so far", async () => {
		let call = 0;
		let cancelled = false;
		const fetch = async (): Promise<FetchIdsPageResult> => {
			call++;
			return { ids: ids(500), continuationToken: "more" };
		};
		const outcome = await countMatches(
			fetch,
			() => {
				cancelled = true;
			},
			() => cancelled,
		);
		assert.equal(outcome.cancelled, true);
		assert.equal(call, 1);
		assert.equal(outcome.total, 500);
	});

	test("an infra failure while paging stops the count and reports the error", async () => {
		const boom = new Error("network blip");
		const fetch = async (): Promise<FetchIdsPageResult> => {
			throw boom;
		};
		const outcome = await countMatches(fetch, () => undefined, neverCancelled);
		assert.equal(outcome.error, boom);
		assert.equal(outcome.total, 0);
	});
});

describe("resolveSelectionAfterDelete", () => {
	test("a clean run with nothing failed exits selection mode", () => {
		assert.deepEqual(
			resolveSelectionAfterDelete({
				done: 3412,
				failedIds: [],
				cancelled: false,
			}),
			{ exit: true, retryIds: [] },
		);
	});

	test("explicit failures stay selected for a precise retry, even alongside a clean stop", () => {
		assert.deepEqual(
			resolveSelectionAfterDelete({
				done: 3072,
				failedIds: ["a", "b"],
				cancelled: false,
			}),
			{ exit: false, retryIds: ["a", "b"] },
		);
	});

	test("a clean cancel with nothing yet confirmed failed leaves nothing to retry, but does not exit", () => {
		assert.deepEqual(
			resolveSelectionAfterDelete({
				done: 100,
				failedIds: [],
				cancelled: true,
			}),
			{ exit: false, retryIds: [] },
		);
	});

	test("an infra failure with no explicit per-item failures still keeps selection mode open", () => {
		assert.deepEqual(
			resolveSelectionAfterDelete({
				done: 0,
				failedIds: [],
				cancelled: false,
				error: new Error("network blip"),
			}),
			{ exit: false, retryIds: [] },
		);
	});

	test("failedIds wins over cancelled/error when both are present", () => {
		assert.deepEqual(
			resolveSelectionAfterDelete({
				done: 10,
				failedIds: ["x"],
				cancelled: true,
				error: new Error("boom"),
			}),
			{ exit: false, retryIds: ["x"] },
		);
	});
});
