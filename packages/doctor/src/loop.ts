import { attempt } from "./attempt.js";
import type { DoctorConfig } from "./config.js";
import { advance } from "./dwell.js";
import type { Log } from "./log.js";
import type { CounterState, DoctorState } from "./state.js";
import type { CheckResult } from "./verdict.js";
import type { Delivery } from "./webhook.js";

export interface LoopDependencies {
	readonly runCheck: (
		counters: Readonly<Record<string, CounterState>>,
	) => Promise<CheckResult>;
	readonly saveState: (state: DoctorState) => Promise<void>;
	readonly postWebhook: (result: CheckResult) => Promise<Delivery>;
	readonly pingDeadMan: () => Promise<void>;
	readonly now: () => Date;
	readonly log: Log;
}

/**
 * One turn of the loop: check, decide, announce a settled change, record, ping.
 *
 * A transition is spent when the endpoint has answered about it, not when it is
 * decided. A payload an endpoint rejects (4xx) is a decision that repeating
 * cannot change, so `firedVerdict` advances and the operator gets one error
 * line. A payload that never arrived — a timeout, a refused connection, a 5xx —
 * is not a decision, so `firedVerdict` is left where it was and the next check
 * announces the same transition again. `candidateRuns` is already pinned at the
 * dwell count, so the retry is immediate rather than another three checks away.
 *
 * The dead-man's switch cannot cover a lost delivery. It is a different URL at
 * a different provider and it answers 200 all week while a webhook is down, so
 * without the retry one transient 5xx on the firing check is an outage the
 * operator is never told about, and the next thing they hear is the recovery.
 *
 * The state is written after the attempt, which means a crash in the gap
 * between a delivered alert and the write re-announces once on restart. That is
 * the cheaper of the two failures: a duplicate is noise, a dropped outage alert
 * is the thing this exists to prevent.
 *
 * The dead-man ping is last and unconditional on the verdict. It reports that
 * the checker is running, not what the checker found — a scrape failure
 * degrades the verdict and still pings. A check that throws before producing a
 * verdict does not reach it, which is the whole signal.
 */
export const runOnce = async (
	deps: LoopDependencies,
	config: DoctorConfig,
	state: DoctorState,
): Promise<DoctorState> => {
	const result = await deps.runCheck(state.counters);
	const transition = advance(
		{ ...state, counters: result.counters },
		result.verdict,
		config.dwellChecks,
		deps.now(),
	);

	deps.log.debug(
		{
			verdict: result.verdict,
			reasons: result.reasons.map((reason) => reason.code),
			settledRuns: transition.state.candidateRuns,
			fires: transition.fires ?? null,
		},
		"doctor: check complete",
	);

	let next = transition.state;
	const fired = transition.fires;
	if (fired !== undefined && config.webhookUrl !== undefined) {
		const delivery = await attempt(deps.postWebhook(result));
		const outcome: Delivery = delivery.ok
			? delivery.value
			: { kind: "unreachable", detail: delivery.error };
		if (outcome.kind === "sent") {
			deps.log.info({ verdict: fired }, "doctor: alert sent");
		} else if (outcome.kind === "rejected") {
			deps.log.error(
				{ verdict: fired, error: outcome.detail },
				"doctor: the webhook refused this payload; the transition is spent",
			);
		} else {
			// Roll the announcement back. Everything else the check learned —
			// the counter baselines, the settled run — is kept.
			next = { ...next, firedVerdict: state.firedVerdict };
			deps.log.error(
				{ verdict: fired, error: outcome.detail },
				"doctor: the webhook could not be reached; retrying on the next check",
			);
		}
	}

	await deps.saveState(next);

	if (config.deadManUrl !== undefined) {
		const ping = await attempt(deps.pingDeadMan());
		if (!ping.ok) {
			deps.log.error({ error: ping.error }, "doctor: dead-man ping failed");
		}
	}

	return next;
};

export interface RunLoopOptions {
	readonly deps: LoopDependencies;
	readonly config: DoctorConfig;
	readonly initial: DoctorState;
	readonly signal: AbortSignal;
	readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Runs until aborted. A check that throws is logged and the loop continues: the
 * container that reports the stack's failures must not be brought down by one
 * of them, and a crash-looping checker is a dead-man's switch that fires for
 * the wrong reason.
 */
export const runLoop = async (
	options: RunLoopOptions,
): Promise<DoctorState> => {
	let state = options.initial;
	while (!options.signal.aborted) {
		const turn = await attempt(runOnce(options.deps, options.config, state));
		if (turn.ok) {
			state = turn.value;
		} else {
			options.deps.log.error(
				{ error: turn.error },
				"doctor: check failed to produce a verdict",
			);
		}
		await options.sleep(options.config.intervalMs, options.signal);
	}
	return state;
};

export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
