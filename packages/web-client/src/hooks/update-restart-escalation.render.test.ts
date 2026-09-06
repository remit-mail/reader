/**
 * The update poll against the app's own fail-fast sink (#468).
 *
 * An update stops and starts the backend on purpose, so the proxy in front of
 * it answers 502 for the seconds it is gone. Every other test in this package
 * mounts on the harness's plain `QueryClient`, which has no global sink, so none
 * of them can see that the 502 took the whole screen before the update surface
 * ever read it. Mounted here on the client `shell/index.tsx` builds.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { act, createElement } from "react";
import { SelfUpdateOverlay } from "@/components/self-update/SelfUpdateOverlay";
import { __resetFatalError, getCurrentFatalError } from "@/lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "@/lib/query-error-handler";
import {
	APPLY_BUDGET_SECONDS,
	NEVER_CAME_BACK_MARGIN_SECONDS,
} from "@/lib/self-update-state";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import {
	type SelfUpdateApi,
	SelfUpdateProvider,
	useSelfUpdate,
} from "./use-system-update";
import "@/lib/client";

const BUDGET_MS =
	(APPLY_BUDGET_SECONDS + NEVER_CAME_BACK_MARGIN_SECONDS) * 1000;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let api: SelfUpdateApi | undefined;

beforeEach(() => {
	__resetFatalError();
});

afterEach(() => {
	__resetFatalError();
	http?.restore();
	http = undefined;
	harness?.close();
	harness = undefined;
	api = undefined;
});

const available = {
	currentVersion: "0.9.3",
	check: {
		status: "ok",
		updateAvailable: true,
		latestVersion: "0.9.4",
		publishedAt: "2026-07-14T09:00:00.000Z",
		summary: "Faster first sync.",
		releaseNotesUrl: "https://example.test/notes",
	},
	run: null,
};

const accepted = {
	currentVersion: "0.9.3",
	check: { status: "ok", updateAvailable: true, latestVersion: "0.9.4" },
	run: {
		runId: "upd_1",
		fromVersion: "0.9.3",
		targetVersion: "0.9.4",
		phase: "stopping",
		outcome: null,
		startedAt: "2026-07-20T11:59:30.000Z",
		updatedAt: "2026-07-20T11:59:45.000Z",
		message: "Restarting Remit on 0.9.4.",
		logCommand: "remit logs --since 10m",
	},
};

/** The client `shell/index.tsx` builds: the real global escalation sink. */
const appQueryClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

const hook = (): SelfUpdateApi => {
	if (!api) throw new Error("hook not mounted");
	return api;
};

const dom = (): DomHarness => {
	if (!harness) throw new Error("nothing mounted");
	return harness;
};

/** Mount the surface, with `poll` deciding what each `GET /system/update` answers. */
async function mount(poll: () => unknown): Promise<void> {
	http = mockFetch((call) => {
		if (call.path.endsWith("/system/update") && call.method === "GET") {
			return poll();
		}
		return accepted;
	});
	const Probe = () => {
		api = useSelfUpdate();
		return null;
	};
	harness = createDomHarness({ queryClient: appQueryClient() });
	harness.renderApp(
		createElement(
			SelfUpdateProvider,
			null,
			createElement(Probe),
			createElement(SelfUpdateOverlay),
		),
	);
	await settle();
}

async function settle(): Promise<void> {
	for (let round = 0; round < 40; round += 1) {
		await dom().flush();
		await dom().wait(0);
	}
}

/** Press install and wait for the run this page now holds to reach the surface. */
async function install(): Promise<void> {
	await act(async () => {
		hook().install("0.9.4");
		await dom().flush();
	});
	await dom().waitFor(() => {
		const surface = hook().surface;
		return surface.status === "ready" && surface.overlay.kind === "applying";
	}, "the install to be accepted");
}

async function repoll(): Promise<void> {
	await act(async () => {
		hook().onRetryConnection();
		await dom().flush();
	});
	await settle();
}

describe("the update poll across the restart it asked for (#468)", () => {
	test("a 502 while a run is held keeps the update surface, not the fatal page", async () => {
		let restarting = false;
		await mount(() => (restarting ? httpError(502) : available));
		await install();

		restarting = true;
		await repoll();

		assert.equal(getCurrentFatalError(), null);
		const surface = hook().surface;
		assert.equal(
			surface.status === "ready" &&
				surface.section.status === "applying" &&
				surface.section.phase,
			"reconnecting",
		);
		assert.match(dom().html(), /Installing Remit 0\.9\.4/);
	});

	test("the same 502 with no run held escalates", async () => {
		await mount(() => httpError(502));

		assert.equal(getCurrentFatalError()?.error !== undefined, true);
	});

	test("a 500 while a run is held escalates — the server answered", async () => {
		let broken = false;
		await mount(() => (broken ? httpError(500) : available));
		await install();

		broken = true;
		await repoll();

		assert.equal(getCurrentFatalError()?.error !== undefined, true);
	});

	test("a 502 past the apply budget gives up loudly, still not fatally", async () => {
		let restarting = false;
		await mount(() => (restarting ? httpError(502) : available));
		await install();

		restarting = true;
		const realNow = Date.now;
		Date.now = () => realNow() + BUDGET_MS + 60_000;
		try {
			await repoll();

			assert.equal(getCurrentFatalError(), null);
			assert.match(dom().html(), /has not answered since the restart/);
			assert.match(dom().html(), /remit logs/);
			assert.doesNotMatch(dom().html(), /Installing Remit 0\.9\.4/);
		} finally {
			Date.now = realNow;
		}
	});
});
