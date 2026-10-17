import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attempt, safeJsonParse } from "./attempt.js";
import { isReasonCode, type ReasonCode, type Verdict } from "./verdict.js";

/**
 * What the checker has to remember across a restart: which verdict it last
 * announced, how long the current one has held, and the counter totals a delta
 * is measured against.
 *
 * Without the first field a container restart re-announces a condition already
 * reported, which is precisely the noise D8 exists to remove — and a checker
 * with `restart: unless-stopped` restarts on every `remit update`.
 */
export const STATE_VERSION = 3;

/**
 * A counter's last observed total, and when it last went up.
 *
 * The total is the baseline a delta is measured against. `lastRoseAt` is what
 * makes the signal a condition rather than an instant: authentication failures
 * arrive in one burst per sync tick, so the quiet hour between two bursts is
 * not a recovery, and a reason that is true for one check in sixty can never
 * satisfy a three-check dwell.
 */
export interface CounterState {
	readonly total: number;
	/** Epoch milliseconds, or `null` when it has not risen since first seen. */
	readonly lastRoseAt: number | null;
}

/**
 * How long one reason has held its current presence, so a reason that appears
 * while the stack is already degraded is announced on the same dwell rule as
 * the verdict, and one that flickers is never announced at all.
 */
export interface ReasonRun {
	readonly present: boolean;
	/** Consecutive checks agreeing on `present`, held at the dwell count. */
	readonly runs: number;
}

export interface DoctorState {
	readonly version: typeof STATE_VERSION;
	/** The last verdict actually sent. Never null: a fresh install is healthy. */
	readonly firedVerdict: Verdict;
	/** The verdict the run below is counting. */
	readonly candidateVerdict: Verdict;
	/** Consecutive checks that have agreed on `candidateVerdict`. */
	readonly candidateRuns: number;
	readonly counters: Readonly<Record<string, CounterState>>;
	/** The reasons the last announcement carried, or that have held since. */
	readonly firedReasons: readonly ReasonCode[];
	readonly reasonRuns: Readonly<Partial<Record<ReasonCode, ReasonRun>>>;
	/**
	 * Dead-letter depth per queue that growth is measured against: the depth at
	 * the last announcement, lowered whenever a queue drains below it, so a
	 * replay that empties a queue makes its next failure news again.
	 */
	readonly firedDeadLetters: Readonly<Record<string, number>>;
	readonly updatedAt: string | undefined;
}

/**
 * A stack that has never been checked is assumed healthy rather than unknown.
 * Treating it as unknown makes the first settled `healthy` a transition, so
 * every install would announce itself to the operator's channel on boot, and
 * the one message people learn to ignore is the one that arrives when nothing
 * is wrong.
 */
export const initialState: DoctorState = {
	version: STATE_VERSION,
	firedVerdict: "healthy",
	candidateVerdict: "healthy",
	candidateRuns: 0,
	counters: {},
	firedReasons: [],
	reasonRuns: {},
	firedDeadLetters: {},
	updatedAt: undefined,
};

const isVerdict = (value: unknown): value is Verdict =>
	value === "healthy" || value === "degraded";

const isCounterState = (value: unknown): value is CounterState =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as CounterState).total === "number" &&
	(typeof (value as CounterState).lastRoseAt === "number" ||
		(value as CounterState).lastRoseAt === null);

const isReasonRun = (value: unknown): value is ReasonRun =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as ReasonRun).present === "boolean" &&
	typeof (value as ReasonRun).runs === "number";

const isRecordOf = <T>(
	value: unknown,
	isEntry: (entry: unknown) => entry is T,
): value is Record<string, T> =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	Object.values(value).every(isEntry);

const isCounters = (value: unknown): value is Record<string, CounterState> =>
	isRecordOf(value, isCounterState);

const isReasonRuns = (
	value: unknown,
): value is Partial<Record<ReasonCode, ReasonRun>> =>
	isRecordOf(value, isReasonRun) && Object.keys(value).every(isReasonCode);

const isDepth = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/**
 * A state file this version does not recognise is replaced by the baseline, not
 * refused. The alternative is a container that will not start because of its
 * own bookkeeping, and the cost of the reset is at most one repeated alert.
 */
export const parseState = async (raw: string): Promise<DoctorState> => {
	const parsed = await safeJsonParse<unknown>(raw).catch(() => undefined);
	if (typeof parsed !== "object" || parsed === null) return initialState;
	const candidate = parsed as Record<string, unknown>;
	if (
		candidate.version !== STATE_VERSION ||
		!isVerdict(candidate.firedVerdict) ||
		!isVerdict(candidate.candidateVerdict) ||
		typeof candidate.candidateRuns !== "number" ||
		!isCounters(candidate.counters) ||
		!Array.isArray(candidate.firedReasons) ||
		!candidate.firedReasons.every(isReasonCode) ||
		!isReasonRuns(candidate.reasonRuns) ||
		!isRecordOf(candidate.firedDeadLetters, isDepth)
	) {
		return initialState;
	}
	return {
		version: STATE_VERSION,
		firedVerdict: candidate.firedVerdict,
		candidateVerdict: candidate.candidateVerdict,
		candidateRuns: candidate.candidateRuns,
		counters: candidate.counters,
		firedReasons: candidate.firedReasons,
		reasonRuns: candidate.reasonRuns,
		firedDeadLetters: candidate.firedDeadLetters,
		updatedAt:
			typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined,
	};
};

export const stateFile = (directory: string): string =>
	join(directory, "state.json");

export const readState = async (directory: string): Promise<DoctorState> => {
	const raw = await attempt(readFile(stateFile(directory), "utf8"));
	return raw.ok ? parseState(raw.value) : initialState;
};

/**
 * Write then rename. A checker killed mid-write must come back to the previous
 * state rather than to a truncated file it would read as a fresh install and
 * re-announce from.
 */
export const writeState = async (
	directory: string,
	state: DoctorState,
): Promise<void> => {
	await mkdir(directory, { recursive: true });
	const target = stateFile(directory);
	const temporary = `${target}.tmp`;
	await writeFile(temporary, `${JSON.stringify(state, null, "\t")}\n`);
	await rename(temporary, target);
};
