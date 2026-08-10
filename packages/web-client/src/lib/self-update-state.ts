/**
 * The self-update state machine, isolated from React.
 *
 * `GET /system/update` returns three independent things: the running version,
 * the outcome of the last manifest check, and the state of the current or last
 * run. This module folds that response — plus the run this client started and
 * holds in memory, plus the clock — into the single `SelfUpdateState` the
 * `@remit/ui` components render, and into the full-window blocking overlay.
 *
 * The design constraints (RFC 037 Interface, issue #135) live here:
 *  - The server decides whether an update is running and how far along it is.
 *    Every phase shown is one the server reported for this run; an answer the
 *    client is still waiting for renders no phase at all.
 *  - A held run turns a failed request into `applying`, never `unreachable`.
 *  - Once the apply budget plus a margin has passed with no answer — a failed
 *    request, or a server answering without accounting for the run — that
 *    silence becomes "the server never came back", a state that never claims
 *    the rollback ran, because from a dead connection the client cannot know.
 *  - The check block and the run block are independent: a check that cannot
 *    reach the update source is a failed check, never a failed update.
 */
import type {
	RemitImapSystemUpdateCheck,
	RemitImapSystemUpdateOutcome,
	RemitImapSystemUpdatePhase,
	RemitImapSystemUpdateResponse,
	RemitImapSystemUpdateRun,
} from "@remit/api-http-client/types.gen.ts";
import type {
	CheckingPrevious,
	ReleaseInfo,
	SelfUpdateState,
	UpdatePhase,
} from "@remit/ui";
import { getErrorStatus } from "./error-classifier";

/**
 * The longest an apply can plausibly take — pull, snapshot, stop, start, gate —
 * before a silent server is treated as gone rather than still working. A five
 * minute margin is added on top before the client gives up entirely.
 */
export const APPLY_BUDGET_SECONDS = 600;
export const NEVER_CAME_BACK_MARGIN_SECONDS = 300;

/** Shown on the dead-connection screens, where no server-authored command exists. */
export const FALLBACK_LOGS_COMMAND = "remit logs";

const RELEASE_TAG_BASE = "https://github.com/remit-mail/reader/releases/tag/";

/**
 * The run this client asked for, kept in memory for as long as the page that
 * asked lives. Nothing is written to storage: a run lasts about a minute and
 * only the server knows how it ends, so a page that was not there for the
 * request starts from the server's answer instead of from a record of its own.
 */
export interface HeldRun {
	runId: string;
	attemptedVersion: string;
	previousVersion: string;
	/** The phase the server reported when it accepted the run. */
	phase: UpdatePhase;
	/** Epoch millis when the client began holding this run. */
	startedAt: number;
}

export type UpdateOverlay =
	| { kind: "none" }
	| {
			kind: "applying";
			target: string;
			phase: UpdatePhase;
			elapsedSeconds: number;
	  }
	| {
			kind: "neverCameBack";
			attemptedVersion: string;
			previousVersion: string;
			elapsedSeconds: number;
			logsCommand: string;
	  };

export type UpdateSurface =
	| { status: "absent" }
	| { status: "loading" }
	| { status: "ready"; section: SelfUpdateState; overlay: UpdateOverlay };

export interface DeriveInput {
	data: RemitImapSystemUpdateResponse | undefined;
	isError: boolean;
	error: unknown;
	held: HeldRun | null;
	dismissedRunId: string | null;
	now: number;
}

export interface DeriveResult {
	surface: UpdateSurface;
	/** The held run should be dropped — the server has accounted for it. */
	releaseHeld: boolean;
}

const API_PHASE_TO_UI: Record<RemitImapSystemUpdatePhase, UpdatePhase> = {
	checking: "preparing",
	pulling: "preparing",
	snapshotting: "preparing",
	stopping: "restarting",
	starting: "restarting",
	verifying: "reconnecting",
	committing: "reconnecting",
	rollingBack: "reconnecting",
	recovering: "reconnecting",
};

export function mapUpdatePhase(phase: RemitImapSystemUpdatePhase): UpdatePhase {
	return API_PHASE_TO_UI[phase] ?? "reconnecting";
}

/**
 * The surface has no entry point for this caller: `404` (no manifest URL
 * configured) or `401` (not authenticated). Both render nothing and stop the
 * poll. `403` is treated the same way as defensive cover for any authenticated
 * edge state, though the backend no longer distinguishes callers once the
 * surface is on.
 */
export function isSurfaceAbsent(error: unknown): boolean {
	const status = getErrorStatus(error);
	return status === 404 || status === 403 || status === 401;
}

/**
 * A release out of whatever fields a check block carries, regardless of its
 * current `status` — while a check is `pending` the fields left over from the
 * previous answer are what "the last known answer" means (issue #599).
 */
function releaseFromCheckFields(
	check: RemitImapSystemUpdateCheck,
	now: number,
): ReleaseInfo | undefined {
	if (!check.updateAvailable || !check.latestVersion) return undefined;
	return {
		version: check.latestVersion,
		releasedAt: parseIso(check.publishedAt) ?? now,
		releaseNotesUrl:
			check.releaseNotesUrl ?? releaseNotesUrl(check.latestVersion),
		summary: check.summary ?? "",
	};
}

/**
 * The available release from the check block, or undefined when the check
 * reports none. Independent of what the pane is currently showing, so a retry
 * offered from a failed run can still open consent.
 */
export function releaseFromCheck(
	data: RemitImapSystemUpdateResponse | undefined,
	now: number,
): ReleaseInfo | undefined {
	const check = data?.check;
	if (check?.status !== "ok") return undefined;
	return releaseFromCheckFields(check, now);
}

/**
 * What the last check answered, read off whatever fields survive alongside a
 * `pending` status — the check block keeps them so the panel can show the
 * last known answer next to "checking now" (issue #599).
 */
function previousFromCheck(
	check: RemitImapSystemUpdateCheck,
	now: number,
): CheckingPrevious | undefined {
	if (check.error !== undefined) {
		return {
			kind: "failed",
			reason: check.error,
			lastCheckedAt: parseIso(check.lastCheckedAt),
		};
	}
	const release = releaseFromCheckFields(check, now);
	if (release) return { kind: "available", release };
	if (check.lastCheckedAt !== undefined) {
		return {
			kind: "upToDate",
			checkedAt: parseIso(check.lastCheckedAt) ?? now,
		};
	}
	return undefined;
}

/**
 * Whether installing the latest release runs a schema migration during the
 * offline window. Derived in the client from the two versions the surface
 * carries — the API deliberately ships the versions, never a computed boolean.
 * Silent unless both are present and the release is on a higher schema.
 */
export function appliesSchemaMigration(
	data: RemitImapSystemUpdateResponse | undefined,
): boolean {
	const target = data?.check.schemaVersion;
	const current = data?.currentSchemaVersion;
	if (target === undefined || current === undefined) return false;
	return target > current;
}

function budgetLimitSeconds(): number {
	return APPLY_BUDGET_SECONDS + NEVER_CAME_BACK_MARGIN_SECONDS;
}

function elapsedSince(startMillis: number, now: number): number {
	return Math.max(0, Math.floor((now - startMillis) / 1000));
}

function parseIso(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function releaseNotesUrl(version: string): string {
	return `${RELEASE_TAG_BASE}${version}`;
}

function applyingSection(
	runId: string,
	version: string,
	target: string,
	phase: UpdatePhase,
	elapsedSeconds: number,
): SelfUpdateState {
	return { status: "applying", runId, version, target, phase, elapsedSeconds };
}

function terminalSection(
	data: RemitImapSystemUpdateResponse,
	run: RemitImapSystemUpdateRun,
	outcome: RemitImapSystemUpdateOutcome,
): SelfUpdateState {
	switch (outcome) {
		case "succeeded":
			return {
				status: "succeeded",
				runId: run.runId,
				version: run.targetVersion,
				previousVersion: run.fromVersion,
				releaseNotesUrl:
					data.check.releaseNotesUrl ?? releaseNotesUrl(run.targetVersion),
			};
		case "rolledBack":
			return {
				status: "rolledBack",
				runId: run.runId,
				version: run.fromVersion,
				attemptedVersion: run.targetVersion,
				reason: run.message,
				logsCommand: run.logCommand,
			};
		case "rollbackFailed":
			return {
				status: "rollbackFailed",
				runId: run.runId,
				attemptedVersion: run.targetVersion,
				previousVersion: run.fromVersion,
				reason: run.message,
				logsCommand: run.logCommand,
			};
		case "abandoned":
			return {
				status: "abandoned",
				runId: run.runId,
				version: run.fromVersion,
				attemptedVersion: run.targetVersion,
				reason: run.message,
				logsCommand: run.logCommand,
			};
		default: {
			const exhaustive: never = outcome;
			return exhaustive;
		}
	}
}

function checkSection(
	data: RemitImapSystemUpdateResponse,
	now: number,
): SelfUpdateState {
	const check = data.check;

	// The server, not a local guess, says a check is in flight — a press that
	// never reached the seam renders nothing new until it does (issue #599).
	// Whatever the previous answer left in the same check block is carried
	// forward, so this never blanks a known answer to show the spinner.
	if (check.status === "pending") {
		return {
			status: "checking",
			version: data.currentVersion,
			previous: previousFromCheck(check, now),
		};
	}

	if (check.status === "failed") {
		return {
			status: "checkFailed",
			version: data.currentVersion,
			reason: check.error ?? "Remit could not reach the update service.",
			lastCheckedAt: parseIso(check.lastCheckedAt),
		};
	}

	// A configured surface that has not run its first check yet is never-checked,
	// not checking: the updater runs the check on a cadence and has not written a
	// result. A spinner here would run forever, since nothing on this poll is in
	// flight. Only a genuine refetch (handled above) shows the spinner.
	if (check.status === "disabled") {
		return { status: "neverChecked", version: data.currentVersion };
	}

	const release = releaseFromCheck(data, now);
	if (release) {
		return { status: "available", version: data.currentVersion, release };
	}

	return {
		status: "upToDate",
		version: data.currentVersion,
		checkedAt: parseIso(check.lastCheckedAt) ?? now,
	};
}

function ready(
	section: SelfUpdateState,
	overlay: UpdateOverlay,
	releaseHeld: boolean,
): DeriveResult {
	return { surface: { status: "ready", section, overlay }, releaseHeld };
}

/**
 * The client gave up waiting. The hold stays: the screen has to sit still, and
 * its retry has to keep polling, until the server answers for itself.
 */
function neverCameBack(held: HeldRun, elapsedSeconds: number): DeriveResult {
	return {
		surface: {
			status: "ready",
			section: applyingSection(
				held.runId,
				held.previousVersion,
				held.attemptedVersion,
				"reconnecting",
				elapsedSeconds,
			),
			overlay: {
				kind: "neverCameBack",
				attemptedVersion: held.attemptedVersion,
				previousVersion: held.previousVersion,
				elapsedSeconds,
				logsCommand: FALLBACK_LOGS_COMMAND,
			},
		},
		releaseHeld: false,
	};
}

/**
 * A held run resolves to one of: still applying, gave up ("never came back"),
 * unaccounted for, still waiting on a first answer, or — returning `null` —
 * resolved terminally on the server, in which case the caller renders the
 * outcome from the response.
 */
function deriveHeld(
	held: HeldRun,
	data: RemitImapSystemUpdateResponse | undefined,
	run: RemitImapSystemUpdateRun | null,
	isError: boolean,
	now: number,
): DeriveResult | null {
	const elapsedSeconds = elapsedSince(held.startedAt, now);
	const currentVersion = data?.currentVersion ?? held.previousVersion;
	const matched = !isError && run !== null && run.runId === held.runId;

	if (matched && run !== null && run.outcome !== null) return null;

	if (matched && run !== null) {
		const phase = mapUpdatePhase(run.phase);
		return ready(
			applyingSection(
				run.runId,
				currentVersion,
				run.targetVersion,
				phase,
				elapsedSeconds,
			),
			{ kind: "applying", target: run.targetVersion, phase, elapsedSeconds },
			false,
		);
	}

	if (isError) {
		if (elapsedSeconds > budgetLimitSeconds()) {
			return neverCameBack(held, elapsedSeconds);
		}
		return ready(
			applyingSection(
				held.runId,
				held.previousVersion,
				held.attemptedVersion,
				"reconnecting",
				elapsedSeconds,
			),
			{
				kind: "applying",
				target: held.attemptedVersion,
				phase: "reconnecting",
				elapsedSeconds,
			},
			false,
		);
	}

	// Nothing has come back yet. Silence is not a phase, so the surface waits
	// rather than describing an install it has heard nothing about.
	if (data === undefined) {
		return { surface: { status: "loading" }, releaseHeld: false };
	}

	// The server answered, but not with our run. If we have been gone longer than
	// the budget, we cannot reconcile the silence — say so and point at the log.
	if (elapsedSeconds > budgetLimitSeconds()) {
		return {
			surface: {
				status: "ready",
				section: {
					status: "unreachable",
					runId: held.runId,
					previousVersion: held.previousVersion,
					attemptedVersion: held.attemptedVersion,
					elapsedSeconds,
					logsCommand: run?.logCommand ?? FALLBACK_LOGS_COMMAND,
				},
				overlay: { kind: "none" },
			},
			releaseHeld: true,
		};
	}

	// The updater picks the request up off a control file, so the seam keeps
	// reporting the previous run for a moment. The phase stays the one the server
	// gave when it accepted this run, until the server reports a newer one.
	return ready(
		applyingSection(
			held.runId,
			currentVersion,
			held.attemptedVersion,
			held.phase,
			elapsedSeconds,
		),
		{
			kind: "applying",
			target: held.attemptedVersion,
			phase: held.phase,
			elapsedSeconds,
		},
		false,
	);
}

function displayFromData(input: DeriveInput): UpdateSurface {
	const { data, isError, dismissedRunId, now } = input;

	if (isError) {
		return {
			status: "ready",
			section: {
				status: "checkFailed",
				version: data?.currentVersion ?? "the current version",
				reason: "Remit could not reach the update service.",
			},
			overlay: { kind: "none" },
		};
	}

	if (!data) return { status: "loading" };

	const run = data.run;
	const dismissed =
		run !== null && dismissedRunId !== null && run.runId === dismissedRunId;

	if (run !== null && !dismissed && run.outcome !== null) {
		return {
			status: "ready",
			section: terminalSection(data, run, run.outcome),
			overlay: { kind: "none" },
		};
	}

	if (run !== null && !dismissed && run.outcome === null) {
		const elapsedSeconds = elapsedSince(parseIso(run.startedAt) ?? now, now);
		const phase = mapUpdatePhase(run.phase);
		return {
			status: "ready",
			section: applyingSection(
				run.runId,
				run.fromVersion,
				run.targetVersion,
				phase,
				elapsedSeconds,
			),
			overlay: {
				kind: "applying",
				target: run.targetVersion,
				phase,
				elapsedSeconds,
			},
		};
	}

	return {
		status: "ready",
		section: checkSection(data, now),
		overlay: { kind: "none" },
	};
}

export function deriveUpdateSurface(input: DeriveInput): DeriveResult {
	const { data, isError, error, held, now } = input;
	const run = data?.run ?? null;

	if (isSurfaceAbsent(error) && !held) {
		return { surface: { status: "absent" }, releaseHeld: true };
	}

	if (held) {
		const heldResult = deriveHeld(held, data, run, isError, now);
		if (heldResult) return heldResult;
		// Our run resolved terminally — render it from the response and let go.
		return { surface: displayFromData(input), releaseHeld: true };
	}

	return { surface: displayFromData(input), releaseHeld: false };
}
