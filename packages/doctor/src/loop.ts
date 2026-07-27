import { attempt } from "./attempt.js";
import type { DoctorConfig } from "./config.js";
import { advance } from "./dwell.js";
import type { Log } from "./log.js";
import type { DoctorState } from "./state.js";
import type { CheckResult } from "./verdict.js";

export interface LoopDependencies {
	readonly runCheck: (
		counters: Readonly<Record<string, number>>,
	) => Promise<CheckResult>;
	readonly saveState: (state: DoctorState) => Promise<void>;
	readonly postWebhook: (result: CheckResult) => Promise<void>;
	readonly pingDeadMan: () => Promise<void>;
	readonly now: () => Date;
	readonly log: Log;
}

/**
 * One turn of the loop: check, decide, announce a settled change, record, ping.
 *
 * The state is written before the webhook is posted. A transition is spent when
 * it is decided, not when it is delivered (D8/D12): a checker that crashed
 * between the two would otherwise come back and announce the same condition
 * again, and a repeated alert is the noise the dwell rule exists to remove. A
 * delivery that fails is reported in the log and caught by the dead-man's
 * switch, which is what notices a webhook path that has stopped working.
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

	await deps.saveState(transition.state);

	const fired = transition.fires;
	if (fired !== undefined && config.webhookUrl !== undefined) {
		const delivery = await attempt(deps.postWebhook(result));
		if (delivery.ok) {
			deps.log.info({ verdict: fired }, "doctor: alert sent");
		} else {
			deps.log.error(
				{ verdict: fired, error: delivery.error },
				"doctor: alert delivery failed; the transition is spent",
			);
		}
	}

	if (config.deadManUrl !== undefined) {
		const ping = await attempt(deps.pingDeadMan());
		if (!ping.ok) {
			deps.log.error({ error: ping.error }, "doctor: dead-man ping failed");
		}
	}

	return transition.state;
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
