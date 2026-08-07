/**
 * Closes the seam the existing #648-review tests each cover half of.
 * `useReportSpam.integration.test.ts` builds a synthetic mutation via
 * `mutationCache.build()` and never mounts the hook; `useReportSpam.render.
 * test.ts` mounts the hook but under `createDomHarness`'s default
 * `QueryClient`, which carries no global cache handlers. Neither exercises the
 * JOIN: the real `useMutation` calls in `useReportSpam.ts`, under a
 * `QueryClient` wired with the real `QueryCache`/`MutationCache` handlers from
 * `lib/query-error-handler.ts` the way `shell/index.tsx` builds it, wrapped in
 * the real `ErrorBannerProvider`. Deleting `meta: { softError: true }` from
 * the real hook passes both existing tests — that is the bug that shipped
 * twice and passed CI both times.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createElement, Fragment } from "react";
import { FatalErrorOverlay } from "../components/ui/FatalErrorOverlay";
import { __resetFatalError, subscribeFatalError } from "../lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "../lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import { useReportSpam } from "./useReportSpam";

let harness: DomHarness | undefined;
let http: HttpMock;

const mountHook = <T>(useHook: () => T): (() => T) => {
	let value: T | undefined;
	const Probe = () => {
		value = useHook();
		return null;
	};
	const queryClient = new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: { mutations: { retry: false } },
	});
	harness = createDomHarness({ queryClient });
	harness.renderApp(
		createElement(
			Fragment,
			null,
			createElement(FatalErrorOverlay),
			createElement(Probe),
		),
	);
	return () => {
		if (value === undefined) throw new Error("hook did not render");
		return value;
	};
};

/** See `useReportSpam.render.test.ts` — the chain from a resolved fetch to a re-render crosses enough async boundaries that a fixed microtask count reads as flaky under load. */
const waitFor = async (
	predicate: () => boolean,
	timeoutMs = 2000,
): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(
				`waitFor: condition never became true within ${timeoutMs}ms`,
			);
		}
		await harness.flush();
		await harness.wait(5);
	}
};

const bannerAlerts = () =>
	harness?.queryAll('[aria-label="Notifications"] [role="alert"]') ?? [];

const fatalOverlay = () =>
	harness?.query('[data-testid="fatal-error-overlay"]') ?? null;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
	__resetFatalError();
});

describe("useReportSpam under the real global cache handlers (#648 review, the join both existing tests missed)", () => {
	it("a per-message report failure banners once and never mounts the fatal overlay — report direction", async () => {
		const fatalsSeen: string[] = [];
		subscribeFatalError((fatal) => fatalsSeen.push(fatal.message));
		http = mockFetch(() => ({ failureCount: 1 }));
		const hook = mountHook(() => useReportSpam({ mailboxId: "mbx-inbox" }));

		hook().reportSpam(["msg-1"]);
		await waitFor(() => bannerAlerts().length > 0);

		assert.equal(
			fatalOverlay() !== null,
			false,
			"the fatal overlay must not mount",
		);
		assert.deepEqual(fatalsSeen, [], "no fatal error must be raised");
		assert.equal(bannerAlerts().length, 1, "exactly one banner");
	});

	it("a per-message undo failure banners once and never mounts the fatal overlay — undo direction", async () => {
		const fatalsSeen: string[] = [];
		subscribeFatalError((fatal) => fatalsSeen.push(fatal.message));
		http = mockFetch(() => ({ failureCount: 1 }));
		const hook = mountHook(() => useReportSpam({ mailboxId: "mbx-junk" }));

		hook().notSpam(["msg-1"]);
		await waitFor(() => bannerAlerts().length > 0);

		assert.equal(
			fatalOverlay() !== null,
			false,
			"the fatal overlay must not mount",
		);
		assert.deepEqual(fatalsSeen, [], "no fatal error must be raised");
		assert.equal(bannerAlerts().length, 1, "exactly one banner");
	});

	it("a genuine 500 from the same endpoint still escalates — meta.softError must not swallow the 5xx class", async () => {
		http = mockFetch(() => httpError(500, "spam service is down"));
		const hook = mountHook(() => useReportSpam({ mailboxId: "mbx-inbox" }));

		hook().reportSpam(["msg-1"]);
		await waitFor(() => fatalOverlay() !== null);

		assert.ok(fatalOverlay(), "a 5xx must still reach the fatal overlay");
	});
});
