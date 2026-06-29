/**
 * Integration: prove the global React Query caches route a first-party error
 * through the fail-fast handlers → `reportFatalError`, which is what drives the
 * full-screen escalation overlay. React Query's core runs headless (no DOM),
 * so this exercises the real `QueryCache`/`MutationCache` wiring from main.tsx
 * without rendering.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "./query-error-handler";

afterEach(() => {
	__resetFatalError();
});

const makeClient = () =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: { queries: { retry: false } },
	});

describe("global query/mutation escalation", () => {
	it("a first-party 5xx from a query escalates to the fatal overlay seam", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();

		await client
			.fetchQuery({
				queryKey: ["explode"],
				queryFn: async () => {
					throw new ApiError("internal server error", 500);
				},
			})
			.catch(() => {});

		assert.deepEqual(seen, ["internal server error"]);
	});

	it("a 5xx on a background REFETCH escalates — the exact #1059 bug (semantic-search-style query that 500s after first rendering data)", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();
		const queryKey = ["semanticSearch"];
		let calls = 0;
		const queryFn = async () => {
			calls += 1;
			if (calls === 1) return { items: [] as string[] };
			throw new ApiError("semantic search exploded", 500);
		};

		// First load succeeds → query now has data (dataUpdatedAt !== 0). Under the
		// deleted guard this refetch 500 vanished into `data?.items ?? []`.
		await client.fetchQuery({ queryKey, queryFn });
		await client.refetchQueries({ queryKey }).catch(() => {});

		assert.deepEqual(seen, ["semantic search exploded"]);
	});

	it("a first-party 5xx from a mutation escalates to the fatal overlay seam", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();

		const mutation = client.getMutationCache().build(client, {
			mutationFn: async () => {
				throw new ApiError("mutation blew up", 503);
			},
		});
		await mutation.execute(undefined).catch(() => {});

		assert.deepEqual(seen, ["mutation blew up"]);
	});

	it("a 404 on a query marked meta.softError does NOT escalate (call site owns the empty state)", async () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		const client = makeClient();

		await client
			.fetchQuery({
				queryKey: ["missing"],
				queryFn: async () => {
					throw new ApiError("not found", 404);
				},
				meta: { softError: true },
			})
			.catch(() => {});

		assert.equal(escalated, false);
	});

	it("a 404 on a query that did NOT opt out escalates by default", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();

		await client
			.fetchQuery({
				queryKey: ["unhandled-404"],
				queryFn: async () => {
					throw new ApiError("not found", 404);
				},
			})
			.catch(() => {});

		assert.deepEqual(seen, ["not found"]);
	});

	it("a statusless `Failed to fetch` (offline blip) from a query does NOT escalate", async () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		const client = makeClient();

		await client
			.fetchQuery({
				queryKey: ["offline"],
				queryFn: async () => {
					throw new TypeError("Failed to fetch");
				},
			})
			.catch(() => {});

		assert.equal(escalated, false);
	});
});
