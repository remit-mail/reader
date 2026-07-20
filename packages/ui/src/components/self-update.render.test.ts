import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	demoLogsCommand,
	demoRelease,
	demoRunId,
	type SelfUpdateState,
	updateWaitNote,
} from "./self-update.js";
import { SelfUpdateConfirmDialog } from "./self-update-confirm-dialog.js";
import { UpdateAvailableDot } from "./self-update-dot.js";
import {
	SelfUpdateProgressOverlay,
	SelfUpdateUnreachableScreen,
} from "./self-update-progress-overlay.js";
import { SelfUpdateSection } from "./self-update-section.js";

const noop = () => {};
const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const CURRENT = "0.9.3";

/** SSR splits interpolations with comment markers; sentences read across them. */
const render = (element: Parameters<typeof renderToString>[0]) =>
	renderToString(element).replaceAll("<!-- -->", "");

const section = (state: SelfUpdateState) =>
	render(
		createElement(SelfUpdateSection, {
			state,
			now: NOW,
			onCheck: noop,
			onInstall: noop,
			onDismissResult: noop,
		}),
	);

describe("SelfUpdateSection", () => {
	it("states being up to date without raising an alert", () => {
		const html = section({
			status: "upToDate",
			version: CURRENT,
			checkedAt: NOW - 60_000,
		});
		assert.match(html, /0\.9\.3 is the latest version/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("offers an available update without shouting about it", () => {
		const html = section({
			status: "available",
			version: CURRENT,
			release: demoRelease,
		});
		assert.match(html, /Install 0\.9\.4/);
		assert.match(html, /Release notes/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	it("names the automatic rollback before the user commits", () => {
		const html = section({
			status: "available",
			version: CURRENT,
			release: demoRelease,
		});
		assert.match(html, /restored on its own/);
	});

	it("keeps a failed check separate from a failed update", () => {
		const html = section({
			status: "checkFailed",
			version: CURRENT,
			reason: "No route to github.com",
			lastCheckedAt: NOW - 3_600_000,
		});
		assert.match(html, /Could not reach the update source/);
		assert.match(html, /still on 0\.9\.3 and it keeps working/);
		assert.match(html, /Try again/);
	});

	it("says which version is running after a rollback, and where the log is", () => {
		const html = section({
			status: "rolledBack",
			runId: demoRunId,
			version: CURRENT,
			attemptedVersion: "0.9.4",
			reason: "migration 0042 failed",
			logsCommand: demoLogsCommand,
		});
		assert.match(html, /running 0\.9\.3 again/);
		assert.match(html, /migration 0042 failed/);
		assert.match(html, /remit logs --since 10m/);
	});

	it("attributes the rollback to the server rather than asserting it", () => {
		const html = section({
			status: "rolledBack",
			runId: demoRunId,
			version: CURRENT,
			attemptedVersion: "0.9.4",
			reason: "migration 0042 failed",
			logsCommand: demoLogsCommand,
		});
		assert.match(html, /Remit reports that it put 0\.9\.3 back/);
	});

	it("never claims data survived a failed update", () => {
		const html = section({
			status: "rolledBack",
			runId: demoRunId,
			version: CURRENT,
			attemptedVersion: "0.9.4",
			reason: "migration 0042_add_thread_index failed",
			logsCommand: demoLogsCommand,
		});
		// The server reported a rollback and a reason. It reported nothing about
		// data, and a half-applied migration is exactly where that matters.
		assert.doesNotMatch(html, /Nothing was lost/);
		assert.doesNotMatch(html, /everything works/);
		assert.match(html, /can still have changed things/);
	});

	it("renders every status rather than going blank", () => {
		assert.match(
			section({
				status: "applying",
				runId: demoRunId,
				version: CURRENT,
				target: "0.9.4",
				phase: "restarting",
				elapsedSeconds: 20,
			}),
			/Installing Remit 0\.9\.4/,
		);
		assert.match(
			section({
				status: "unreachable",
				runId: demoRunId,
				previousVersion: CURRENT,
				attemptedVersion: "0.9.4",
				elapsedSeconds: 420,
				logsCommand: demoLogsCommand,
			}),
			/left the server unreachable/,
		);
	});

	it("offers a way forward from every failure", () => {
		const rolledBack = section({
			status: "rolledBack",
			runId: demoRunId,
			version: CURRENT,
			attemptedVersion: "0.9.4",
			reason: "boom",
			logsCommand: demoLogsCommand,
		});
		assert.match(rolledBack, /Try 0\.9\.4 again/);
		assert.match(rolledBack, /Stay on 0\.9\.3/);
	});

	it("keeps the check control pressable while a check is running", () => {
		const html = section({ status: "checking", version: CURRENT });
		assert.match(html, /Check again/);
		assert.doesNotMatch(html, /disabled=/);
	});
});

describe("SelfUpdateConfirmDialog", () => {
	const html = render(
		createElement(SelfUpdateConfirmDialog, {
			open: true,
			currentVersion: CURRENT,
			release: demoRelease,
			onClose: noop,
			onConfirm: noop,
		}),
	);

	it("reflects the consequence in the order the user will feel it", () => {
		assert.match(html, /lose its connection/);
		assert.match(html, /stays at your provider/);
		assert.match(html, /restored automatically/);
	});

	it("always offers the way back", () => {
		assert.match(html, /Not now/);
	});

	it("renders nothing when closed", () => {
		assert.equal(
			renderToString(
				createElement(SelfUpdateConfirmDialog, {
					open: false,
					currentVersion: CURRENT,
					release: demoRelease,
					onClose: noop,
					onConfirm: noop,
				}),
			),
			"",
		);
	});
});

describe("SelfUpdateProgressOverlay", () => {
	it("tells the user the disconnection is expected", () => {
		const html = render(
			createElement(SelfUpdateProgressOverlay, {
				target: "0.9.4",
				phase: "restarting",
				elapsedSeconds: 20,
			}),
		);
		assert.match(html, /no server to talk to/);
		assert.match(html, /Waiting for Remit to answer again/);
	});

	it("stops promising a minute once a minute has passed", () => {
		assert.match(updateWaitNote(30), /about a minute/);
		assert.doesNotMatch(updateWaitNote(200), /about a minute/);
	});

	it("never describes the server from a lost connection", () => {
		// The unreachable screen refuses to claim the rollback ran; the timeout
		// copy sits on the same dead connection and may not claim it either.
		for (const seconds of [30, 120, 240, 600]) {
			assert.doesNotMatch(updateWaitNote(seconds), /old version|way back|kept/);
		}
	});

	it("blocks the window rather than its nearest positioned ancestor", () => {
		const html = render(
			createElement(SelfUpdateProgressOverlay, {
				target: "0.9.4",
				phase: "restarting",
				elapsedSeconds: 20,
			}),
		);
		assert.match(html, /fixed inset-0/);
		assert.doesNotMatch(html, /absolute inset-0/);
		assert.match(html, /aria-modal="true"/);
	});

	it("scopes the live region to the line that changes", () => {
		const html = render(
			createElement(SelfUpdateProgressOverlay, {
				target: "0.9.4",
				phase: "restarting",
				elapsedSeconds: 20,
			}),
		);
		assert.equal(html.match(/aria-live/g)?.length, 1);
	});
});

describe("SelfUpdateUnreachableScreen", () => {
	const html = render(
		createElement(SelfUpdateUnreachableScreen, {
			attemptedVersion: "0.9.4",
			previousVersion: CURRENT,
			elapsedSeconds: 420,
			logsCommand: demoLogsCommand,
			onRetryConnection: noop,
		}),
	);

	it("raises an alert and never claims the rollback succeeded", () => {
		assert.match(html, /role="alertdialog"/);
		assert.match(html, /aria-modal="true"/);
		assert.match(html, /cannot confirm that from here/);
	});

	it("points at the machine that can answer", () => {
		assert.match(html, /remit logs --since 10m/);
		assert.match(html, /Try connecting again/);
	});
});

describe("UpdateAvailableDot", () => {
	it("carries a label for assistive tech when shown", () => {
		const html = renderToString(
			createElement(UpdateAvailableDot, { show: true }, null),
		);
		assert.match(html, /Update available/);
	});

	it("adds nothing when there is no update", () => {
		const html = renderToString(
			createElement(UpdateAvailableDot, { show: false }, null),
		);
		assert.doesNotMatch(html, /Update available/);
	});
});
