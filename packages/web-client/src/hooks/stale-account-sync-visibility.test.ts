/**
 * Coming back to a tab always leaves the poll loop with a next tick (#1031).
 *
 * A tick that fires while the tab is hidden deliberately does not reschedule —
 * `visibilitychange` is the only thing that resumes the loop. While that resume
 * was itself conditional on a poll being due, the resume could be skipped for
 * good: press refresh (which opens the hot 30s window), hide the tab shortly
 * after a hot tick, let the window lapse while away, and the return is measured
 * against the ambient interval the tab never slept through. Nothing re-armed,
 * and the tab stopped polling until the account list changed or the layout
 * remounted.
 *
 * At the default the ambient and hot intervals are equal and the loop is safe
 * either way, so these drive a deployment that lengthened
 * `mailboxPollIntervalSeconds` — the only shape where the bug is reachable.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import {
	__resetHotSyncWindow,
	HOT_POLL_INTERVAL_MS,
	HOT_WINDOW_MS,
	startHotSyncWindow,
} from "@/lib/hot-sync-window";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";

const ACCOUNT_ID = "acc-1";
const AMBIENT_SECONDS = 600;
const AMBIENT_MS = AMBIENT_SECONDS * 1000;
const T0 = 1_700_000_000_000;

// The hook resolves the ambient interval once, at module load, so the config has
// to be in place before it is imported.
globalThis.__REMIT_CONFIG__ = {
	mailboxPollIntervalSeconds: String(AMBIENT_SECONDS),
};
const { __resetStaleAccountSyncGuard, POLL_INTERVAL_MS, useStaleAccountSync } =
	await import("./useStaleAccountSync.js");

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

function PollLoop() {
	useStaleAccountSync([makeAccount({ accountId: ACCOUNT_ID, lastSyncAt: T0 })]);
	return null;
}

/**
 * jsdom reports "prerender" unless it is pretending to be visual, and the
 * shared environment deliberately does not — so a spec about a tab being looked
 * at has to say so.
 */
const setVisibility = (state: "hidden" | "visible"): void => {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => state,
	});
};

/** Enough microtask turns for a dispatched poll to reach the fetch seam. */
const settle = async (dom: DomHarness): Promise<void> => {
	for (let round = 0; round < 3; round += 1) await dom.flush();
};

const mount = async (): Promise<DomHarness> => {
	http = mockFetch(() => ({ status: "queued" }));
	const dom = createDomHarness();
	harness = dom;
	dom.render(
		createElement(
			QueryClientProvider,
			{ client: dom.queryClient },
			createElement(PollLoop),
		),
	);
	await settle(dom);
	return dom;
};

const advance = async (dom: DomHarness, ms: number): Promise<void> => {
	await act(async () => {
		mock.timers.tick(ms);
	});
	await settle(dom);
};

const goVisible = async (dom: DomHarness): Promise<void> => {
	setVisibility("visible");
	dom.dispatch(dom.document, new Event("visibilitychange"));
	await settle(dom);
};

const goHidden = async (dom: DomHarness): Promise<void> => {
	setVisibility("hidden");
	dom.dispatch(dom.document, new Event("visibilitychange"));
	await settle(dom);
};

/** Every background sync this tab has fired since it mounted. */
const polls = (): number => http?.to(`/${ACCOUNT_ID}/sync`).length ?? 0;

describe("the poll loop across hide and show, on a long ambient interval", () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
	});

	afterEach(() => {
		mock.timers.reset();
		harness?.close();
		harness = undefined;
		http?.restore();
		http = undefined;
		__resetHotSyncWindow();
		__resetStaleAccountSyncGuard();
		Reflect.deleteProperty(document, "visibilityState");
	});

	test("the deployment under test really is on a lengthened interval", () => {
		assert.equal(POLL_INTERVAL_MS, AMBIENT_MS);
	});

	test("keeps polling after a refresh press, a hidden hot window and a return", async () => {
		setVisibility("visible");
		const dom = await mount();

		// The press: the hot window opens and the loop drops onto its cadence.
		startHotSyncWindow();
		await advance(dom, HOT_POLL_INTERVAL_MS);
		assert.equal(polls(), 1, "the hot cadence polled once");

		// Away before the next hot tick, and back only after the window lapsed.
		await goHidden(dom);
		await advance(dom, HOT_WINDOW_MS);
		assert.equal(polls(), 1, "a hidden tab polled");

		await goVisible(dom);
		assert.equal(
			polls(),
			1,
			"the return polled a tab that is not due on the ambient interval",
		);

		await advance(dom, AMBIENT_MS);
		assert.equal(polls(), 2, "the tab came back with no tick scheduled");
	});

	test("polls on return once the ambient interval has passed", async () => {
		setVisibility("visible");
		const dom = await mount();

		await goHidden(dom);
		await advance(dom, AMBIENT_MS);
		assert.equal(polls(), 0, "a hidden tab polled");

		await goVisible(dom);
		assert.equal(polls(), 1, "a tab due a poll did not catch up on return");

		await advance(dom, AMBIENT_MS);
		assert.equal(polls(), 2, "the catch-up left no next tick behind it");
	});
});
