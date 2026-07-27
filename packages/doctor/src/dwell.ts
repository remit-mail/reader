import type { DoctorState } from "./state.js";
import type { Verdict } from "./verdict.js";

export interface Transition {
	readonly state: DoctorState;
	/** The verdict to announce, or `undefined` for the silence that is normal. */
	readonly fires: Verdict | undefined;
}

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
	verdict: Verdict,
	dwellChecks: number,
	now: Date,
): Transition => {
	const runs = state.candidateVerdict === verdict ? state.candidateRuns + 1 : 1;
	const settled = runs >= dwellChecks;
	const fires = settled && verdict !== state.firedVerdict ? verdict : undefined;
	return {
		state: {
			...state,
			candidateVerdict: verdict,
			// Held at the dwell count rather than counting up forever: the run only
			// ever answers "has it settled", and an unbounded integer in a file that
			// lives for years is a number with nothing to say.
			candidateRuns: Math.min(runs, dwellChecks),
			firedVerdict: fires ?? state.firedVerdict,
			updatedAt: now.toISOString(),
		},
		fires,
	};
};
