/**
 * A 401 escalates over `meta.softError` only when someone is waiting on the
 * answer. The self-update poll is the case that made that seam necessary: it is
 * mounted at the app root and answers 401 by design for anyone whose session has
 * lapsed, so escalating it put the full-screen fatal page over every screen in
 * the app at load — including the sign-in the shell was already about to ask
 * for.
 *
 * Held with the real caches wired to `lib/query-error-handler.ts`, because the
 * seam is in what those two handlers pass and a classifier unit test cannot see
 * a caller that never passed anything.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	MutationCache,
	QueryCache,
	QueryClient,
	useMutation,
} from "@tanstack/react-query";
import { createElement, Fragment, useEffect } from "react";
import { FatalErrorOverlay } from "../components/ui/FatalErrorOverlay";
import { ApiError } from "../lib/api";
import { softErrorMeta } from "../lib/error-classifier";
import { __resetFatalError } from "../lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "../lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import { SelfUpdateProvider } from "./use-system-update";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	__resetFatalError();
});

const escalatingClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

const fatalOverlay = () =>
	harness?.query('[data-testid="fatal-error-overlay"]') ?? null;

/** A write nobody pressed a button for, refused for want of a session. */
const SoftWrite = () => {
	const mutation = useMutation({
		mutationFn: async (): Promise<void> => {
			throw new ApiError("signed out", 401);
		},
		meta: softErrorMeta,
	});
	const { mutate } = mutation;
	useEffect(() => {
		mutate();
	}, [mutate]);
	return null;
};

describe("a 401 and who was waiting on it", () => {
	it("leaves the app standing when the root update poll is signed out", async () => {
		http = mockFetch((call) => {
			if (call.path.endsWith("/system/update")) {
				return httpError(401, "session expired");
			}
			return {};
		});

		harness = createDomHarness({ queryClient: escalatingClient() });
		harness.renderApp(
			createElement(
				Fragment,
				null,
				createElement(FatalErrorOverlay),
				createElement(SelfUpdateProvider, null),
			),
		);
		await harness.flush();
		await harness.wait(50);
		await harness.flush();

		assert.ok(
			http.to("/system/update").length > 0,
			"the poll was made, so the 401 really was classified",
		);
		assert.equal(
			fatalOverlay(),
			null,
			"a background poll's 401 must not take the whole app down",
		);
	});

	it("still escalates a soft write's 401 — no banner signs anyone back in", async () => {
		harness = createDomHarness({ queryClient: escalatingClient() });
		harness.renderApp(
			createElement(
				Fragment,
				null,
				createElement(FatalErrorOverlay),
				createElement(SoftWrite),
			),
		);
		await harness.flush();
		await harness.wait(50);
		await harness.flush();

		assert.ok(
			fatalOverlay(),
			"a signed-out session must reach the page that signs back in",
		);
	});
});
