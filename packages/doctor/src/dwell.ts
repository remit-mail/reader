import type { DoctorState, ReasonRun } from "./state.js";
import type { CheckResult, ReasonCode } from "./verdict.js";

export interface Transition {
	readonly state: DoctorState;
	/** The headline to announce, or `undefined` for the silence that is normal. */
	readonly fires: string | undefined;
}

const plural = (count: number, one: string, many: string): string =>
	count === 1 ? one : many;

const trackReasons = (
	previous: DoctorState["reasonRuns"],
	present: ReadonlySet<ReasonCode>,
	dwellChecks: number,
): Partial<Record<ReasonCode, ReasonRun>> => {
	const codes = new Set<ReasonCode>([
		...(Object.keys(previous) as ReasonCode[]),
		...present,
	]);
	const next: Partial<Record<ReasonCode, ReasonRun>> = {};
	for (const code of codes) {
		const isPresent = present.has(code);
		const before = previous[code];
		const runs = before?.present === isPresent ? before.runs + 1 : 1;
		next[code] = { present: isPresent, runs: Math.min(runs, dwellChecks) };
	}
	return next;
};

const settledAs = (
	run: ReasonRun | undefined,
	present: boolean,
	dwellChecks: number,
): boolean =>
	run !== undefined && run.present === present && run.runs >= dwellChecks;

const lowered = (
	baseline: Readonly<Record<string, number>>,
	depths: Readonly<Record<string, number>>,
): Record<string, number> =>
	Object.fromEntries(
		Object.entries(depths).map(([queue, depth]) => [
			queue,
			Math.min(baseline[queue] ?? 0, depth),
		]),
	);

/**
 * D8. A verdict is announced when it changes AND has held for `dwellChecks`
 * consecutive checks. Never on an unchanged verdict, however long it persists.
 *
 * Transition-only firing without the dwell is the loudest possible response to
 * a flapping signal: a verdict that oscillates every check sends two messages
 * per cycle, which is worse than the periodic posting this rejects. A
 * dead-letter message an operator replays and that fails again, and an account
 * sitting on the sync-age threshold, both produce that shape.
 *
 * The cost is detection latency: at the default 60 s interval and three checks,
 * an outage is announced up to three minutes after it starts and a recovery up
 * to three minutes after it clears. Nobody acts inside three minutes on a
 * mailbox that stopped syncing, and the dead-man's switch — which pings on
 * every completed check, settled or not — is unaffected.
 *
 * `fires` is what the caller should send. It is the caller's job to record the
 * returned state whether or not delivery succeeded: a transition is spent when
 * it is decided, so a webhook that rejects the payload does not turn into an
 * announcement on every subsequent check.
 */
export const advance = (
	state: DoctorState,
	result: CheckResult,
	dwellChecks: number,
	now: Date,
): Transition => {
	const { verdict } = result;
	const runs = state.candidateVerdict === verdict ? state.candidateRuns + 1 : 1;
	const settled = runs >= dwellChecks;
	const present = new Set(result.reasons.map((reason) => reason.code));
	const reasonRuns = trackReasons(state.reasonRuns, present, dwellChecks);
	const firedReasons = state.firedReasons.filter(
		(code) => !settledAs(reasonRuns[code], false, dwellChecks),
	);
	const baseline = state.firedDeadLetters;
	const depths = result.deadLetters;

	const fires = ((): string | undefined => {
		if (!settled) return undefined;
		if (verdict !== state.firedVerdict) return result.summary;
		if (verdict !== "degraded") return undefined;
		const newReasons = result.reasons.filter(
			(reason) =>
				!firedReasons.includes(reason.code) &&
				settledAs(reasonRuns[reason.code], true, dwellChecks),
		);
		const grown = Object.entries(depths ?? {})
			.filter(([queue, depth]) => depth > (baseline[queue] ?? 0))
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([queue, depth]) => {
				const delta = depth - (baseline[queue] ?? 0);
				return `${delta} more ${plural(delta, "message", "messages")} on dead-letter queue ${queue} (${depth} in total)`;
			});
		const changes = [
			...newReasons.map((reason) => `new: ${reason.summary}`),
			...grown,
		];
		if (changes.length === 0) return undefined;
		return `remit is still degraded, and worse: ${changes.join("; ")}`;
	})();

	const nextDeadLetters = ((): Readonly<Record<string, number>> => {
		if (depths === undefined) return baseline;
		return fires === undefined ? lowered(baseline, depths) : { ...depths };
	})();

	return {
		state: {
			...state,
			candidateVerdict: verdict,
			// Held at the dwell count rather than counting up forever: the run only
			// ever answers "has it settled", and an unbounded integer in a file that
			// lives for years is a number with nothing to say.
			candidateRuns: Math.min(runs, dwellChecks),
			firedVerdict: fires === undefined ? state.firedVerdict : verdict,
			firedReasons: fires !== undefined ? [...present] : firedReasons,
			reasonRuns: Object.fromEntries(
				Object.entries(reasonRuns).filter(
					([, run]) => run.present || run.runs < dwellChecks,
				),
			),
			firedDeadLetters: nextDeadLetters,
			updatedAt: now.toISOString(),
		},
		fires,
	};
};
