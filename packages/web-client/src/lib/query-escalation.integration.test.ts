/**
 * Integration: prove the global React Query caches route a first-party 5xx
 * through `handleQueryError` → `reportFatalError`, which is what drives the
 * full-screen escalation overlay. React Query's core runs headless (no DOM),
 * so this exercises the real `QueryCache`/`MutationCache` wiring from main.tsx
 * without rendering.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";
import { handleQueryCacheError, handleQueryError } from "./query-error-handler";

afterEach(() => {
	__resetFatalError();
});

const makeClient = () =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleQueryError }),
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

	it("an expected 404 from a query does NOT escalate", async () => {
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
			})
			.catch(() => {});

		assert.equal(escalated, false);
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
