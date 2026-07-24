/**
 * Integration: prove the global React Query caches route a first-party error
 * through the fail-fast handlers → `reportFatalError`, which is what drives the
 * full-screen escalation overlay. React Query's core runs headless (no DOM),
 * so this exercises the real `QueryCache`/`MutationCache` wiring from main.tsx
 * without rendering.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	configOperationsGetConfigQueryKey,
	outboxOperationsListOutboxMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { BACKGROUND_POLL_ESCALATION_THRESHOLD } from "./error-classifier";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";
import { NetworkError } from "./network-error";
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

	it("an offline blip tagged at the fetch boundary does NOT escalate", async () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		const client = makeClient();

		await client
			.fetchQuery({
				queryKey: ["offline"],
				queryFn: async () => {
					throw new NetworkError(new TypeError("Failed to fetch"));
				},
			})
			.catch(() => {});

		assert.equal(escalated, false);
	});
});

describe("background-poll escalation (#225)", () => {
	const markBackgroundPoll = (client: QueryClient) => {
		// The exact wiring the shell installs: attach the background-poll marker to
		// the real config/outbox query keys via setQueryDefaults, so a poll's
		// transient 5xx is classified soft without touching any call site.
		client.setQueryDefaults(configOperationsGetConfigQueryKey(), {
			meta: { backgroundPoll: true },
		});
		client.setQueryDefaults(outboxOperationsListOutboxMessagesQueryKey(), {
			meta: { backgroundPoll: true },
		});
	};

	const explode500 = async () => {
		throw new ApiError("apisix unreachable", 502);
	};

	it("a transient 5xx on the config poll does NOT escalate — the #225 blip", async () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		const client = makeClient();
		markBackgroundPoll(client);

		await client
			.fetchQuery({
				queryKey: configOperationsGetConfigQueryKey(),
				queryFn: explode500,
			})
			.catch(() => {});

		assert.equal(escalated, false);
	});

	it("a transient 5xx on the outbox poll does NOT escalate — the #225 blip", async () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		const client = makeClient();
		markBackgroundPoll(client);

		await client
			.fetchQuery({
				queryKey: outboxOperationsListOutboxMessagesQueryKey(),
				queryFn: explode500,
			})
			.catch(() => {});

		assert.equal(escalated, false);
	});

	it("a PERSISTENT 5xx on a poll escalates once it crosses the threshold", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();
		markBackgroundPoll(client);
		const queryKey = configOperationsGetConfigQueryKey();

		// One failed poll below the threshold, then refetches until it is reached.
		await client.fetchQuery({ queryKey, queryFn: explode500 }).catch(() => {});
		for (let i = 1; i < BACKGROUND_POLL_ESCALATION_THRESHOLD; i += 1) {
			assert.equal(seen.length, 0, `stayed quiet through failure ${i}`);
			await client.refetchQueries({ queryKey }).catch(() => {});
		}

		assert.deepEqual(seen, ["apisix unreachable"]);
	});

	it("a success between failures resets the streak — no escalation", async () => {
		let escalated = false;
		subscribeFatalError(() => {
			escalated = true;
		});
		const client = makeClient();
		markBackgroundPoll(client);
		const queryKey = configOperationsGetConfigQueryKey();
		let calls = 0;
		const flaky = async () => {
			calls += 1;
			// Fail, fail, succeed, fail, fail — never THRESHOLD in a row.
			if (calls === 3) return { ok: true };
			throw new ApiError("apisix unreachable", 502);
		};

		await client.fetchQuery({ queryKey, queryFn: flaky }).catch(() => {});
		for (let i = 0; i < 4; i += 1) {
			await client.refetchQueries({ queryKey }).catch(() => {});
		}

		assert.equal(escalated, false);
	});

	it("a statusless client bug on a poll ALWAYS escalates — the marker never softens our own crash", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();
		markBackgroundPoll(client);

		await client
			.fetchQuery({
				queryKey: configOperationsGetConfigQueryKey(),
				queryFn: async () => {
					throw new TypeError("cannot read property 'id' of undefined");
				},
			})
			.catch(() => {});

		assert.deepEqual(seen, ["cannot read property 'id' of undefined"]);
	});
});
