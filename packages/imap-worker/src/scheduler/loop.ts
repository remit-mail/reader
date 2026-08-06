import { setTimeout as delay } from "node:timers/promises";
import type { Heartbeat } from "@remit/sqs-client/heartbeat";
import type { RunSchedulerTickDeps, SchedulerTickResult } from "./run-tick.js";

/**
 * The scheduled-sync loop, separated from the wiring in runner.ts for the same
 * reason `runQueuePoller` is separate from the container that starts it: the
 * order of the two calls below is a property worth holding, and a module that
 * connects to a queue and a database at import time cannot be asked about it.
 *
 * The beat lands after the tick returns, never before. A tick that throws on
 * every pass exits the process and is restarted every few seconds, so a beat
 * written on the way in would report a scheduler that enqueues nothing as
 * healthy for as long as it kept crashing.
 */
export interface SchedulerLoopOptions {
	readonly tick: (deps: RunSchedulerTickDeps) => Promise<SchedulerTickResult>;
	readonly tickDeps: RunSchedulerTickDeps;
	readonly heartbeat: Heartbeat;
	readonly onHeartbeatError: (error: unknown) => void;
	readonly tickIntervalMs: number;
	readonly wait?: (ms: number) => Promise<void>;
}

export const runSchedulerLoop = async ({
	tick,
	tickDeps,
	heartbeat,
	onHeartbeatError,
	tickIntervalMs,
	wait = (ms) => delay(ms),
}: SchedulerLoopOptions): Promise<never> => {
	for (;;) {
		await tick(tickDeps);
		await heartbeat().catch(onHeartbeatError);
		await wait(tickIntervalMs);
	}
};
