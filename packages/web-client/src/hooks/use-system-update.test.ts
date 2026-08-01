/**
 * The self-update hook, wired end to end against the generated client through a
 * mocked fetch. The pure state machine is covered in `lib/self-update-state.test.ts`;
 * these exercise the parts only the live hook has: what a page claims before the
 * server has answered, the run this page starts and holds, and the poll that
 * survives a dead server.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { systemOperationsGetSystemUpdateQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapSystemUpdateResponse,
	RemitImapSystemUpdateRun,
} from "@remit/api-http-client/types.gen.ts";
import { act, createElement, type ReactNode } from "react";
import { SelfUpdateOverlay } from "../components/self-update/SelfUpdateOverlay";
import { AdvancedNavIcon } from "../components/settings/AdvancedNavIcon";
import { SelfUpdatePanel } from "../components/settings/SelfUpdatePanel";
import {
	APPLY_BUDGET_SECONDS,
	NEVER_CAME_BACK_MARGIN_SECONDS,
} from "../lib/self-update-state";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import {
	type SelfUpdateApi,
	SelfUpdateProvider,
	useSelfUpdate,
} from "./use-system-update";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

// The browser global, as the app would find it. Present so that "a reload
// resumes nothing" is a claim about the app rather than about the harness.
beforeEach(() => {
	globalThis.localStorage = globalThis.window.localStorage;
	localStorage.clear();
});

afterEach(() => {
	http?.restore();
	http = undefined;
	harness?.close();
	harness = undefined;
});

function run(
	overrides: Partial<RemitImapSystemUpdateRun> = {},
): RemitImapSystemUpdateRun {
	return {
		runId: "upd_1",
		fromVersion: "0.9.3",
		targetVersion: "0.9.4",
		phase: "starting",
		outcome: null,
		startedAt: "2026-07-20T11:59:30.000Z",
		updatedAt: "2026-07-20T11:59:45.000Z",
		message: "Restarting Remit on 0.9.4.",
		logCommand: "remit logs --since 10m",
		...overrides,
	};
}

const available: RemitImapSystemUpdateResponse = {
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

const updateKey = systemOperationsGetSystemUpdateQueryKey();
const BUDGET_MS =
	(APPLY_BUDGET_SECONDS + NEVER_CAME_BACK_MARGIN_SECONDS) * 1000;

async function settle(dom: DomHarness): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await dom.flush();
		const state = dom.queryClient.getQueryState(updateKey);
		const done =
			state &&
			state.fetchStatus === "idle" &&
			(state.data !== undefined || state.error != null);
		if (done) {
			// The cache has settled; give React the turns to commit the render it
			// scheduled off that settle before the assert reads the DOM.
			await dom.flush();
			await dom.wait(1);
			await dom.flush();
			return;
		}
		await dom.wait(1);
	}
}

/**
 * Mount the provider with a probe on the hook, so a test can drive `install`
 * and read the surface back. The POST answers with a run in flight, which is
 * what the real seam returns the moment it accepts the request.
 */
function mountApi(
	getResponse: () => unknown,
	children: ReactNode = null,
): { dom: DomHarness; api: () => SelfUpdateApi } {
	http = mockFetch((call) => {
		if (call.path.endsWith("/system/update") && call.method === "GET") {
			return getResponse();
		}
		return {
			currentVersion: "0.9.3",
			check: { status: "ok", updateAvailable: true, latestVersion: "0.9.4" },
			run: run({ outcome: null }),
		};
	});
	let captured: SelfUpdateApi | undefined;
	const Probe = () => {
		captured = useSelfUpdate();
		return null;
	};
	harness = createDomHarness();
	harness.renderApp(
		createElement(SelfUpdateProvider, null, createElement(Probe), children),
	);
	return {
		dom: harness,
		api: () => {
			if (!captured) throw new Error("hook not mounted");
			return captured;
		},
	};
}

async function startUpdate(
	dom: DomHarness,
	api: () => SelfUpdateApi,
): Promise<void> {
	await act(async () => {
		api().install("0.9.4");
		await dom.flush();
		await dom.wait(1);
		await dom.flush();
	});
}

async function renderSurface(
	getResponse: () => unknown,
	children: ReactNode,
): Promise<DomHarness> {
	http = mockFetch((call) => {
		if (call.path.endsWith("/system/update") && call.method === "GET") {
			return getResponse();
		}
		return {};
	});
	harness = createDomHarness();
	harness.renderApp(createElement(SelfUpdateProvider, null, children));
	await settle(harness);
	return harness;
}

describe("SelfUpdatePanel — the surface in Advanced", () => {
	test("a 404 renders no entry point at all", async () => {
		const dom = await renderSurface(
			() => httpError(404),
			createElement(SelfUpdatePanel),
		);
		assert.equal(dom.html(), "");
	});

	test("an available update shows the install action", async () => {
		const dom = await renderSurface(
			() => available,
			createElement(SelfUpdatePanel),
		);
		assert.match(dom.html(), /Install 0\.9\.4/);
	});

	test("a rolled-back run shows the reason and command verbatim", async () => {
		const dom = await renderSurface(
			() => ({
				currentVersion: "0.9.3",
				check: { status: "ok", updateAvailable: false },
				run: run({
					outcome: "rolledBack",
					message: "migration 0042 failed and was reverted",
					logCommand: "remit logs --since 30m",
				}),
			}),
			createElement(SelfUpdatePanel),
		);
		assert.match(dom.html(), /migration 0042 failed and was reverted/);
		assert.match(dom.html(), /remit logs --since 30m/);
	});

	test("a rollback that failed is shown verbatim and needs a shell", async () => {
		const dom = await renderSurface(
			() => ({
				currentVersion: "0.9.3",
				check: { status: "ok", updateAvailable: false },
				run: run({
					outcome: "rollbackFailed",
					message: "snapshot restore errored: database is locked",
					logCommand: "remit logs --since 1h",
				}),
			}),
			createElement(SelfUpdatePanel),
		);
		assert.match(dom.html(), /snapshot restore errored: database is locked/);
		assert.match(dom.html(), /remit logs --since 1h/);
		assert.match(dom.html(), /needs you at a shell/);
	});
});

describe("AdvancedNavIcon — the dot", () => {
	test("shows the update dot when one is available", async () => {
		const dom = await renderSurface(
			() => available,
			createElement(AdvancedNavIcon),
		);
		assert.match(dom.html(), /Update available/);
	});

	test("shows no dot when up to date", async () => {
		const dom = await renderSurface(
			() => ({
				currentVersion: "0.9.3",
				check: { status: "ok", updateAvailable: false },
				run: null,
			}),
			createElement(AdvancedNavIcon),
		);
		assert.doesNotMatch(dom.html(), /Update available/);
	});
});

describe("SelfUpdateOverlay — the blocking screen", () => {
	test("a run this client never started still renders", async () => {
		const dom = await renderSurface(
			() => ({
				currentVersion: "0.9.3",
				check: { status: "ok", updateAvailable: false },
				run: run({ outcome: null }),
			}),
			createElement(SelfUpdateOverlay),
		);
		assert.match(dom.html(), /Installing Remit 0\.9\.4/);
	});

	test("a page that has heard nothing yet says nothing at all", async () => {
		http = mockFetch(() => new Promise(() => {}));
		harness = createDomHarness();
		harness.renderApp(
			createElement(
				SelfUpdateProvider,
				null,
				createElement(SelfUpdateOverlay),
				createElement(SelfUpdatePanel),
			),
		);
		await harness.flush();
		await harness.wait(1);
		await harness.flush();

		assert.equal(harness.html(), "");
	});

	test("the page that asked for the update rides out a failed request", async () => {
		let failing = false;
		const { dom, api } = mountApi(() => {
			if (failing) throw new Error("connection refused");
			return available;
		}, createElement(SelfUpdateOverlay));
		await settle(dom);
		await startUpdate(dom, api);

		failing = true;
		await act(async () => {
			api().onRetryConnection();
			await dom.flush();
			await dom.wait(1);
			await dom.flush();
		});

		const surface = api().surface;
		assert.equal(
			surface.status === "ready" &&
				surface.section.status === "applying" &&
				surface.section.phase,
			"reconnecting",
		);
		assert.match(dom.html(), /Installing Remit 0\.9\.4/);
		assert.doesNotMatch(dom.html(), /has not answered since the restart/);
	});

	test("a silence past the apply budget stops claiming an install is running", async () => {
		let failing = false;
		const { dom, api } = mountApi(() => {
			if (failing) throw new Error("connection refused");
			return available;
		}, createElement(SelfUpdateOverlay));
		await settle(dom);
		await startUpdate(dom, api);

		failing = true;
		const realNow = Date.now;
		Date.now = () => realNow() + BUDGET_MS + 60_000;
		try {
			await act(async () => {
				api().onRetryConnection();
				await dom.flush();
				await dom.wait(1);
				await dom.flush();
			});
			assert.doesNotMatch(dom.html(), /Installing Remit 0\.9\.4/);
			assert.match(dom.html(), /has not answered since the restart/);
			assert.match(dom.html(), /remit logs/);
		} finally {
			Date.now = realNow;
		}
	});

	test("a run the server reports finished ends the wait", async () => {
		let finished = false;
		const { dom, api } = mountApi(
			() =>
				finished
					? {
							currentVersion: "0.9.4",
							check: { status: "ok", updateAvailable: false },
							run: run({ outcome: "succeeded" }),
						}
					: available,
			createElement(SelfUpdateOverlay),
		);
		await settle(dom);
		await startUpdate(dom, api);

		finished = true;
		await act(async () => {
			api().onRetryConnection();
			await dom.flush();
			await dom.wait(1);
			await dom.flush();
		});

		const surface = api().surface;
		assert.equal(
			surface.status === "ready" && surface.section.status,
			"succeeded",
		);
		assert.equal(dom.html(), "");
	});

	test("a reload during the silence resumes nothing", async () => {
		const { dom, api } = mountApi(
			() => available,
			createElement(SelfUpdateOverlay),
		);
		await settle(dom);
		await startUpdate(dom, api);
		assert.match(dom.html(), /Installing Remit 0\.9\.4/);

		http?.restore();
		harness?.close();
		http = mockFetch(() => new Promise(() => {}));
		harness = createDomHarness();
		harness.renderApp(
			createElement(SelfUpdateProvider, null, createElement(SelfUpdateOverlay)),
		);
		await harness.flush();
		await harness.wait(1);
		await harness.flush();

		assert.equal(harness.html(), "");
	});
});

describe("useSystemUpdate — actions", () => {
	test("install takes the run from the surface and writes nothing down", async () => {
		const { dom, api } = mountApi(() => available);
		await settle(dom);
		await startUpdate(dom, api);

		const surface = api().surface;
		assert.equal(
			surface.status === "ready" && surface.overlay.kind,
			"applying",
		);
		assert.equal(
			surface.status === "ready" &&
				surface.section.status === "applying" &&
				surface.section.runId,
			"upd_1",
		);
		assert.equal(localStorage.length, 0);
	});

	test("dismissing a finished result clears the pane", async () => {
		const { dom, api } = mountApi(() => ({
			currentVersion: "0.9.4",
			check: { status: "ok", updateAvailable: false },
			run: run({
				runId: "upd_9",
				outcome: "succeeded",
				targetVersion: "0.9.4",
			}),
		}));
		await settle(dom);

		const before = api().surface;
		assert.equal(
			before.status === "ready" && before.section.status,
			"succeeded",
		);

		await act(async () => {
			api().onDismissResult();
			await dom.flush();
		});

		const after = api().surface;
		assert.equal(after.status === "ready" && after.section.status, "upToDate");
	});

	test("checking and retrying re-poll the surface", async () => {
		let calls = 0;
		const { dom, api } = mountApi(() => {
			calls += 1;
			return available;
		});
		await settle(dom);
		const afterMount = calls;

		await act(async () => {
			api().onCheck();
			await dom.flush();
		});
		await act(async () => {
			api().onRetryConnection();
			await dom.flush();
		});

		assert.equal(calls > afterMount, true);
	});
});
