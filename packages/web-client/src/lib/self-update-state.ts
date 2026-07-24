/**
 * The self-update state machine, isolated from React.
 *
 * `GET /system/update` returns three independent things: the running version,
 * the outcome of the last manifest check, and the state of the current or last
 * run. This module folds that response — plus a run id the client persisted
 * before the server restarted, plus the clock — into the single `SelfUpdateState`
 * the `@remit/ui` components render, and into the full-window blocking overlay.
 *
 * The design constraints (RFC 037 Interface, issue #135) live here:
 *  - A held run id turns a failed request into `applying`, never `unreachable`.
 *  - Once the apply budget plus a margin has passed with no answer, the same
 *    failure becomes "the server never came back" — a state that never claims
 *    the rollback ran, because from a dead connection the client cannot know.
 *  - The check block and the run block are independent: a check that cannot
 *    reach the update source is a failed check, never a failed update.
 */
import type {
	RemitImapSystemUpdateOutcome,
	RemitImapSystemUpdatePhase,
	RemitImapSystemUpdateResponse,
	RemitImapSystemUpdateRun,
} from "@remit/api-http-client/types.gen.ts";
import type { ReleaseInfo, SelfUpdateState, UpdatePhase } from "@remit/ui";
import { getErrorStatus } from "./error-classifier";

/** localStorage key holding the run the client is resuming across a restart. */
export const SELF_UPDATE_RUN_KEY = "remit.self-update.run";

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
 * The record the client persists the moment it asks for an update, so a reload
 * or a second tab can resume watching a run that outlives the page that started
 * it. Everything needed to render the blocking screens without a reachable
 * server is here.
 */
export interface HeldRun {
	runId: string;
	attemptedVersion: string;
	previousVersion: string;
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
	isFetching: boolean;
	held: HeldRun | null;
	dismissedRunId: string | null;
	checkRequested: boolean;
	now: number;
}

export interface DeriveResult {
	surface: UpdateSurface;
	/** The persisted resume token should be removed from localStorage. */
	clearStoredRun: boolean;
	/** The in-memory held run should be dropped — the run is fully resolved. */
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
 * configured), `403` (authenticated but not the instance owner), or `401` (not
 * authenticated). All three render nothing and stop the poll, so a probe cannot
 * tell an off surface from a forbidden one.
 */
export function isSurfaceAbsent(error: unknown): boolean {
	const status = getErrorStatus(error);
	return status === 404 || status === 403 || status === 401;
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

export function loadHeldRun(): HeldRun | null {
	try {
		const raw = localStorage.getItem(SELF_UPDATE_RUN_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isHeldRun(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function saveHeldRun(run: HeldRun): void {
	try {
		localStorage.setItem(SELF_UPDATE_RUN_KEY, JSON.stringify(run));
	} catch {
		// Best effort: private mode or quota. A lost token degrades resume, not
		// correctness — the server remains the authority on the run.
	}
}

export function clearStoredRun(): void {
	try {
		localStorage.removeItem(SELF_UPDATE_RUN_KEY);
	} catch {
		// Best effort, as above.
	}
}

function isHeldRun(value: unknown): value is HeldRun {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.runId === "string" &&
		typeof candidate.attemptedVersion === "string" &&
		typeof candidate.previousVersion === "string" &&
		typeof candidate.startedAt === "number"
	);
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
	isChecking: boolean,
	now: number,
): SelfUpdateState {
	const check = data.check;
	if (isChecking) return { status: "checking", version: data.currentVersion };

	if (check.status === "failed") {
		return {
			status: "checkFailed",
			version: data.currentVersion,
			reason: check.error ?? "Remit could not reach the update service.",
			lastCheckedAt: parseIso(check.lastCheckedAt),
		};
	}

	// A configured surface that has not run its first check yet reads as looking,
	// not as up to date — the client has no basis to claim the latest.
	if (check.status === "disabled") {
		return { status: "checking", version: data.currentVersion };
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
	clearStoredRun: boolean,
	releaseHeld: boolean,
): DeriveResult {
	return {
		surface: { status: "ready", section, overlay },
		clearStoredRun,
		releaseHeld,
	};
}

/**
 * A held run resolves to one of: still applying, gave up ("never came back"),
 * recovered but unaccountable, or — returning `null` — resolved terminally on
 * the server, in which case the caller renders the outcome from the response.
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
			false,
		);
	}

	if (isError) {
		const section = applyingSection(
			held.runId,
			held.previousVersion,
			held.attemptedVersion,
			"reconnecting",
			elapsedSeconds,
		);
		if (elapsedSeconds > budgetLimitSeconds()) {
			return {
				surface: {
					status: "ready",
					section,
					overlay: {
						kind: "neverCameBack",
						attemptedVersion: held.attemptedVersion,
						previousVersion: held.previousVersion,
						elapsedSeconds,
						logsCommand: FALLBACK_LOGS_COMMAND,
					},
				},
				clearStoredRun: true,
				releaseHeld: false,
			};
		}
		return ready(
			section,
			{
				kind: "applying",
				target: held.attemptedVersion,
				phase: "reconnecting",
				elapsedSeconds,
			},
			false,
			false,
		);
	}

	// No answer yet — the resume request is still in flight. Stay applying; only
	// a real error or a real answer moves off it, never a pending first poll.
	if (data === undefined) {
		return ready(
			applyingSection(
				held.runId,
				currentVersion,
				held.attemptedVersion,
				"preparing",
				elapsedSeconds,
			),
			{
				kind: "applying",
				target: held.attemptedVersion,
				phase: "preparing",
				elapsedSeconds,
			},
			false,
			false,
		);
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
			clearStoredRun: true,
			releaseHeld: true,
		};
	}

	// Early: the server is up but has not written our run yet. Still applying.
	const phase =
		run !== null && run.outcome === null
			? mapUpdatePhase(run.phase)
			: "preparing";
	return ready(
		applyingSection(
			held.runId,
			currentVersion,
			held.attemptedVersion,
			phase,
			elapsedSeconds,
		),
		{ kind: "applying", target: held.attemptedVersion, phase, elapsedSeconds },
		false,
		false,
	);
}

function displayFromData(input: DeriveInput): {
	surface: UpdateSurface;
	clearStoredRun: boolean;
} {
	const { data, isError, isFetching, dismissedRunId, checkRequested, now } =
		input;

	if (isError) {
		return {
			surface: {
				status: "ready",
				section: {
					status: "checkFailed",
					version: data?.currentVersion ?? "the current version",
					reason: "Remit could not reach the update service.",
				},
				overlay: { kind: "none" },
			},
			clearStoredRun: true,
		};
	}

	if (!data) {
		return { surface: { status: "loading" }, clearStoredRun: false };
	}

	const run = data.run;
	const dismissed =
		run !== null && dismissedRunId !== null && run.runId === dismissedRunId;

	if (run !== null && !dismissed && run.outcome !== null) {
		return {
			surface: {
				status: "ready",
				section: terminalSection(data, run, run.outcome),
				overlay: { kind: "none" },
			},
			clearStoredRun: true,
		};
	}

	if (run !== null && !dismissed && run.outcome === null) {
		const elapsedSeconds = elapsedSince(parseIso(run.startedAt) ?? now, now);
		const phase = mapUpdatePhase(run.phase);
		return {
			surface: {
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
			},
			clearStoredRun: false,
		};
	}

	return {
		surface: {
			status: "ready",
			section: checkSection(data, checkRequested && isFetching, now),
			overlay: { kind: "none" },
		},
		clearStoredRun: false,
	};
}

export function deriveUpdateSurface(input: DeriveInput): DeriveResult {
	const { data, isError, error, held, now } = input;
	const run = data?.run ?? null;

	if (isSurfaceAbsent(error) && !held) {
		return {
			surface: { status: "absent" },
			clearStoredRun: true,
			releaseHeld: true,
		};
	}

	if (held) {
		const heldResult = deriveHeld(held, data, run, isError, now);
		if (heldResult) return heldResult;
		// Our run resolved terminally — render it from the response and let go.
		const resolved = displayFromData(input);
		return {
			surface: resolved.surface,
			clearStoredRun: true,
			releaseHeld: true,
		};
	}

	const display = displayFromData(input);
	return {
		surface: display.surface,
		clearStoredRun: display.clearStoredRun,
		releaseHeld: false,
	};
}
