import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	RemitImapSystemUpdateResponse,
	RemitImapSystemUpdateRun,
} from "@remit/api-http-client/types.gen.ts";
import { ApiError } from "./api";
import {
	APPLY_BUDGET_SECONDS,
	appliesSchemaMigration,
	CHECK_ANSWER_BUDGET_MS,
	checkRequestFailureReason,
	type DeriveInput,
	deriveUpdateSurface,
	type HeldRun,
	isSurfaceAbsent,
	mapUpdatePhase,
	NEVER_CAME_BACK_MARGIN_SECONDS,
	releaseFromCheck,
} from "./self-update-state";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const BUDGET_MS =
	(APPLY_BUDGET_SECONDS + NEVER_CAME_BACK_MARGIN_SECONDS) * 1000;

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

function response(
	overrides: Partial<RemitImapSystemUpdateResponse> = {},
): RemitImapSystemUpdateResponse {
	return {
		currentVersion: "0.9.3",
		check: { status: "ok", updateAvailable: false, ...overrides.check },
		run: overrides.run ?? null,
		...("currentSchemaVersion" in overrides
			? { currentSchemaVersion: overrides.currentSchemaVersion }
			: {}),
	};
}

function held(overrides: Partial<HeldRun> = {}): HeldRun {
	return {
		runId: "upd_1",
		attemptedVersion: "0.9.4",
		previousVersion: "0.9.3",
		phase: "preparing",
		startedAt: NOW - 10_000,
		...overrides,
	};
}

function input(overrides: Partial<DeriveInput> = {}): DeriveInput {
	return {
		data: undefined,
		isError: false,
		error: undefined,
		held: null,
		dismissedRunId: null,
		checkPress: null,
		checkFailure: null,
		now: NOW,
		...overrides,
	};
}

describe("isSurfaceAbsent", () => {
	test("401, 403 and 404 all read as no entry point", () => {
		for (const status of [401, 403, 404]) {
			assert.equal(isSurfaceAbsent(new ApiError("nope", status)), true);
		}
	});

	test("a 500 or a network blip is not an absent surface", () => {
		assert.equal(isSurfaceAbsent(new ApiError("boom", 500)), false);
		assert.equal(isSurfaceAbsent(new Error("offline")), false);
	});
});

describe("appliesSchemaMigration", () => {
	test("true only when both versions are present and the release is higher", () => {
		assert.equal(
			appliesSchemaMigration(
				response({
					currentSchemaVersion: 4,
					check: { status: "ok", updateAvailable: true, schemaVersion: 5 },
				}),
			),
			true,
		);
	});

	test("false when the release is on the same or a lower schema", () => {
		assert.equal(
			appliesSchemaMigration(
				response({
					currentSchemaVersion: 5,
					check: { status: "ok", updateAvailable: true, schemaVersion: 5 },
				}),
			),
			false,
		);
	});

	test("silent when either version is absent", () => {
		assert.equal(
			appliesSchemaMigration(
				response({ check: { status: "ok", schemaVersion: 5 } }),
			),
			false,
		);
		assert.equal(
			appliesSchemaMigration(response({ currentSchemaVersion: 4 })),
			false,
		);
		assert.equal(appliesSchemaMigration(undefined), false);
	});
});

describe("mapUpdatePhase", () => {
	test("folds the nine server phases into the three the UI shows", () => {
		assert.equal(mapUpdatePhase("pulling"), "preparing");
		assert.equal(mapUpdatePhase("stopping"), "restarting");
		assert.equal(mapUpdatePhase("verifying"), "reconnecting");
		assert.equal(mapUpdatePhase("recovering"), "reconnecting");
	});
});

describe("releaseFromCheck", () => {
	test("builds a release when the check reports one", () => {
		const release = releaseFromCheck(
			response({
				check: {
					status: "ok",
					updateAvailable: true,
					latestVersion: "0.9.4",
					publishedAt: "2026-07-14T09:00:00.000Z",
					summary: "Faster sync.",
					releaseNotesUrl: "https://example.test/notes",
				},
			}),
			NOW,
		);
		assert.equal(release?.version, "0.9.4");
		assert.equal(release?.summary, "Faster sync.");
		assert.equal(release?.releaseNotesUrl, "https://example.test/notes");
	});

	test("undefined when no update is available or the check failed", () => {
		assert.equal(releaseFromCheck(response(), NOW), undefined);
		assert.equal(
			releaseFromCheck(
				response({ check: { status: "failed", error: "no route" } }),
				NOW,
			),
			undefined,
		);
	});
});

describe("deriveUpdateSurface — the surface without a run", () => {
	test("a 404 with no held run renders nothing anywhere", () => {
		const result = deriveUpdateSurface(
			input({ isError: true, error: new ApiError("off", 404) }),
		);
		assert.equal(result.surface.status, "absent");
	});

	test("no data and no error is loading, not absent", () => {
		const result = deriveUpdateSurface(input());
		assert.equal(result.surface.status, "loading");
	});

	test("an available update reads from the check block", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: {
						status: "ok",
						updateAvailable: true,
						latestVersion: "0.9.4",
						summary: "Faster sync.",
					},
				}),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		assert.equal(result.surface.section.status, "available");
	});

	test("no update available reads as up to date", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: {
						status: "ok",
						updateAvailable: false,
						lastCheckedAt: "2026-07-20T11:40:00.000Z",
					},
				}),
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"upToDate",
		);
	});

	test("a configured surface that has not checked yet is never-checked, not a spinner", () => {
		const result = deriveUpdateSurface(
			input({ data: response({ check: { status: "disabled" } }) }),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"neverChecked",
		);
	});

	test("a press keeps checking while the server still reports the answer it had (#599)", () => {
		const stale = {
			status: "ok" as const,
			updateAvailable: false,
			lastCheckedAt: "2026-07-20T11:00:00.000Z",
		};
		const result = deriveUpdateSurface(
			input({
				data: response({ check: stale }),
				checkPress: { pressedAt: NOW - 5_000, since: stale.lastCheckedAt },
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"checking",
		);
	});

	test("a press settles the moment the server reports a newer lastCheckedAt (#599)", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: {
						status: "ok",
						updateAvailable: false,
						lastCheckedAt: "2026-07-20T11:59:50.000Z",
					},
				}),
				checkPress: {
					pressedAt: NOW - 5_000,
					since: "2026-07-20T11:00:00.000Z",
				},
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"upToDate",
		);
	});

	test("a press the updater never answers becomes a loud failure naming it (#599)", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: {
						status: "ok",
						updateAvailable: false,
						lastCheckedAt: "2026-07-20T11:00:00.000Z",
					},
				}),
				checkPress: {
					pressedAt: NOW - CHECK_ANSWER_BUDGET_MS - 1,
					since: "2026-07-20T11:00:00.000Z",
				},
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		const section = result.surface.section;
		assert.equal(section.status, "checkFailed");
		if (section.status !== "checkFailed") return;
		assert.match(section.reason, /updater did not answer/);
		assert.match(section.reason, /remit logs updater/);
		// The age of the answer it is still showing survives the failure.
		assert.equal(section.lastCheckedAt, Date.parse("2026-07-20T11:00:00.000Z"));
	});

	test("a refresh request that failed is reported, never swallowed (#599)", () => {
		const result = deriveUpdateSurface(
			input({
				data: response(),
				checkFailure: checkRequestFailureReason(new ApiError("boom", 500)),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		const section = result.surface.section;
		assert.equal(section.status, "checkFailed");
		if (section.status !== "checkFailed") return;
		assert.match(section.reason, /answered 500/);
	});
});

describe("deriveUpdateSurface — check and run stay independent", () => {
	test("a failed check renders as a failed check, never a failed update", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: { status: "failed", error: "no route to github.com" },
					run: null,
				}),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		assert.equal(result.surface.section.status, "checkFailed");
	});

	test("a failed check does not override a run that finished", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: { status: "failed", error: "no route to github.com" },
					run: run({ outcome: "succeeded" }),
				}),
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"succeeded",
		);
	});
});

describe("deriveUpdateSurface — terminal outcomes", () => {
	test("a rolledBack run renders message and command verbatim", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					run: run({
						outcome: "rolledBack",
						message: "migration 0042 failed",
						logCommand: "remit logs --since 30m",
					}),
				}),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		const section = result.surface.section;
		assert.equal(section.status, "rolledBack");
		if (section.status !== "rolledBack") return;
		assert.equal(section.reason, "migration 0042 failed");
		assert.equal(section.logsCommand, "remit logs --since 30m");
	});

	test("a rollbackFailed run renders message and command verbatim", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					run: run({
						outcome: "rollbackFailed",
						message: "restore errored: database is locked",
						logCommand: "remit logs --since 1h",
					}),
				}),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		const section = result.surface.section;
		assert.equal(section.status, "rollbackFailed");
		if (section.status !== "rollbackFailed") return;
		assert.equal(section.reason, "restore errored: database is locked");
		assert.equal(section.logsCommand, "remit logs --since 1h");
	});

	test("an abandoned run reports the running version unchanged", () => {
		const result = deriveUpdateSurface(
			input({ data: response({ run: run({ outcome: "abandoned" }) }) }),
		);
		const section =
			result.surface.status === "ready" ? result.surface.section : null;
		assert.equal(section?.status, "abandoned");
		assert.equal(section?.status === "abandoned" && section.version, "0.9.3");
	});

	test("a dismissed result falls back to the check block", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({
					check: { status: "ok", updateAvailable: false },
					run: run({ runId: "upd_9", outcome: "succeeded" }),
				}),
				dismissedRunId: "upd_9",
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"upToDate",
		);
	});
});

describe("deriveUpdateSurface — a run this client never started", () => {
	test("an in-flight run renders applying, no held id needed", () => {
		const result = deriveUpdateSurface(
			input({ data: response({ run: run({ outcome: null }) }) }),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		assert.equal(result.surface.section.status, "applying");
		assert.equal(result.surface.overlay.kind, "applying");
	});
});

describe("deriveUpdateSurface — a held run across a restart", () => {
	test("a failed request with a held run is applying, not unreachable", () => {
		const result = deriveUpdateSurface(
			input({
				isError: true,
				error: new Error("connection refused"),
				held: held({ startedAt: NOW - 20_000 }),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		assert.equal(result.surface.section.status, "applying");
		assert.equal(result.surface.overlay.kind, "applying");
		assert.equal(
			result.surface.overlay.kind === "applying" &&
				result.surface.overlay.phase,
			"reconnecting",
		);
	});

	test("a failed request without a held run is a check-level failure", () => {
		const result = deriveUpdateSurface(
			input({
				data: response(),
				isError: true,
				error: new Error("connection refused"),
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"checkFailed",
		);
	});

	test("the budget plus margin elapsing flips applying to never-came-back", () => {
		const result = deriveUpdateSurface(
			input({
				isError: true,
				error: new Error("connection refused"),
				held: held({ startedAt: NOW - BUDGET_MS - 60_000 }),
			}),
		);
		assert.equal(result.surface.status, "ready");
		if (result.surface.status !== "ready") return;
		assert.equal(result.surface.overlay.kind, "neverCameBack");
	});

	test("never-came-back never claims the rollback ran", () => {
		const result = deriveUpdateSurface(
			input({
				isError: true,
				error: new Error("connection refused"),
				held: held({ startedAt: NOW - BUDGET_MS - 60_000 }),
			}),
		);
		if (
			result.surface.status !== "ready" ||
			result.surface.overlay.kind !== "neverCameBack"
		) {
			assert.fail("expected the never-came-back overlay");
		}
		// The overlay carries only what is known: attempted and previous versions,
		// and a command. No success, no rollback verdict.
		assert.equal(result.surface.overlay.attemptedVersion, "0.9.4");
		assert.equal(result.surface.overlay.previousVersion, "0.9.3");
	});

	test("the server answering with the matching run in flight shows its phase", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({ run: run({ phase: "verifying", outcome: null }) }),
				held: held(),
			}),
		);
		if (
			result.surface.status !== "ready" ||
			result.surface.overlay.kind !== "applying"
		) {
			assert.fail("expected the applying overlay");
		}
		assert.equal(result.surface.overlay.phase, "reconnecting");
	});

	test("the matching run resolving terminally clears the held id", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({ run: run({ outcome: "succeeded" }) }),
				held: held(),
			}),
		);
		assert.equal(result.releaseHeld, true);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"succeeded",
		);
	});

	test("a long silence that the server cannot account for reads as unreachable", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({ run: null }),
				held: held({ startedAt: NOW - BUDGET_MS - 60_000 }),
			}),
		);
		assert.equal(
			result.surface.status === "ready" && result.surface.section.status,
			"unreachable",
		);
		assert.equal(result.releaseHeld, true);
	});

	test("a poll with no answer yet claims no phase at all", () => {
		const result = deriveUpdateSurface(
			input({ held: held({ startedAt: NOW - 20_000 }) }),
		);
		assert.equal(result.surface.status, "loading");
	});

	test("a poll that never answers still claims no phase past the budget", () => {
		const result = deriveUpdateSurface(
			input({ held: held({ startedAt: NOW - BUDGET_MS - 60_000 }) }),
		);
		assert.equal(result.surface.status, "loading");
	});

	test("the server's own account of the run it accepted carries the phase", () => {
		const result = deriveUpdateSurface(
			input({
				data: response({ run: null }),
				held: held({ phase: "restarting" }),
			}),
		);
		if (
			result.surface.status !== "ready" ||
			result.surface.overlay.kind !== "applying"
		) {
			assert.fail("expected the applying overlay");
		}
		assert.equal(result.surface.overlay.phase, "restarting");
	});
});
