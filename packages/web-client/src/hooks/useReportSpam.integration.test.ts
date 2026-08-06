/**
 * Integration: prove a per-message report-spam/not-spam failure resolves to a
 * banner, never the full-screen fatal overlay, through the REAL global
 * `MutationCache` wiring (`lib/query-error-handler.ts`, wired on the
 * `QueryClient` in `shell/index.tsx`) — not just `ErrorBannerProvider`'s own
 * `isAlwaysFatal` check.
 *
 * That distinction is the whole point of this file. `ErrorBannerProvider.
 * pushError` refuses to banner an always-fatal error, but every mutation
 * ALSO reports to the MutationCache's global `onError`, independent of
 * whatever the per-mutation `onError` did — and `shouldEscalate` (what the
 * global handler calls) escalates by DEFAULT for any non-5xx that didn't opt
 * out via `meta.softError`. A test that only checked `isAlwaysFatal` passed
 * while the real app crashed to the fatal overlay on the same error: this is
 * exactly `query-escalation.integration.test.ts`'s pattern, applied to
 * `useReportSpam`'s own mutation shape (mutationFn + meta), because that is
 * the seam the earlier fix went through unexercised.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { __resetFatalError, subscribeFatalError } from "../lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "../lib/query-error-handler";
import { throwOnBulkFailure } from "./useReportSpam.js";

afterEach(() => {
	__resetFatalError();
});

const makeClient = () =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: { mutations: { retry: false } },
	});

/** The exact shape a failed report-spam/not-spam call resolves to on the wire (200, not a rejection) — see `throwOnBulkFailure`. */
const failedBulkResult = () => ({
	successCount: 0,
	failureCount: 1,
	failures: [
		{
			messageId: "9m2k7x4vqz1jd0tn3wf8b6y5c",
			reason:
				"Message 9m2k7x4vqz1jd0tn3wf8b6y5c's move to Junk has not settled yet; try again in a moment.",
		},
	],
});

describe("useReportSpam's mutations under the real MutationCache (#648 review)", () => {
	it("with meta.softError, a per-message failure does NOT escalate to the fatal overlay (regression)", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();

		const mutation = client.getMutationCache().build(client, {
			mutationFn: async () => {
				throwOnBulkFailure(failedBulkResult());
			},
			meta: { softError: true },
		});
		await mutation.execute(undefined).catch(() => {});

		assert.deepEqual(
			seen,
			[],
			"a designed, retryable per-message failure must not reach the fatal overlay",
		);
	});

	it("without meta.softError, the same failure DOES escalate — proving the opt-out is load-bearing, not a no-op", async () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));
		const client = makeClient();

		const mutation = client.getMutationCache().build(client, {
			mutationFn: async () => {
				throwOnBulkFailure(failedBulkResult());
			},
		});
		await mutation.execute(undefined).catch(() => {});

		assert.equal(
			seen.length,
			1,
			"this asserts the failure mode the fix removes — a non-5xx with no softError opt-out escalates by default",
		);
	});
});
