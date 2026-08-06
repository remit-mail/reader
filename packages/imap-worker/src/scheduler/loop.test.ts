import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSchedulerLoop, type SchedulerLoopOptions } from "./loop.js";
import type { RunSchedulerTickDeps, SchedulerTickResult } from "./run-tick.js";

const RESULT: SchedulerTickResult = { scanned: 0, enqueued: 0, skipped: 0 };

// Only the loop's own two calls matter here; the tick is a stub, so what it is
// handed is never read.
const TICK_DEPS = {} as RunSchedulerTickDeps;

const buildLoop = (
	overrides: Partial<SchedulerLoopOptions>,
): SchedulerLoopOptions => ({
	tick: () => Promise.resolve(RESULT),
	tickDeps: TICK_DEPS,
	heartbeat: () => Promise.resolve(),
	onHeartbeatError: () => {},
	tickIntervalMs: 1000,
	wait: () => Promise.resolve(),
	...overrides,
});

describe("runSchedulerLoop", () => {
	// The failure the ordering exists to catch: a tick that throws every pass
	// exits the process and compose restarts it every few seconds, so a beat
	// written before the tick would report a scheduler enqueuing nothing as
	// healthy for as long as it kept crashing.
	it("writes no heartbeat for a tick that throws", async () => {
		let beats = 0;
		await assert.rejects(
			runSchedulerLoop(
				buildLoop({
					tick: () => Promise.reject(new Error("tick failed")),
					heartbeat: () => {
						beats += 1;
						return Promise.resolve();
					},
				}),
			),
			/tick failed/,
		);
		assert.equal(beats, 0);
	});

	it("beats once per completed round, and stops beating when a round stops completing", async () => {
		let rounds = 0;
		let beats = 0;
		await assert.rejects(
			runSchedulerLoop(
				buildLoop({
					tick: () => {
						rounds += 1;
						return rounds > 2
							? Promise.reject(new Error("tick failed"))
							: Promise.resolve(RESULT);
					},
					heartbeat: () => {
						beats += 1;
						return Promise.resolve();
					},
				}),
			),
			/tick failed/,
		);
		assert.equal(beats, 2);
	});

	// A full disk is the likeliest cause and the moment mail should keep being
	// enqueued. The missed beat is itself the signal.
	it("keeps ticking when the heartbeat write fails", async () => {
		const errors: unknown[] = [];
		let rounds = 0;
		await assert.rejects(
			runSchedulerLoop(
				buildLoop({
					tick: () => {
						rounds += 1;
						return rounds > 3
							? Promise.reject(new Error("done"))
							: Promise.resolve(RESULT);
					},
					heartbeat: () => Promise.reject(new Error("ENOSPC")),
					onHeartbeatError: (error) => errors.push(error),
				}),
			),
			/done/,
		);
		assert.equal(rounds, 4);
		assert.equal(errors.length, 3);
	});

	it("waits a tick interval between rounds", async () => {
		const waited: number[] = [];
		let rounds = 0;
		await assert.rejects(
			runSchedulerLoop(
				buildLoop({
					tickIntervalMs: 300_000,
					tick: () => {
						rounds += 1;
						return rounds > 2
							? Promise.reject(new Error("done"))
							: Promise.resolve(RESULT);
					},
					wait: (ms) => {
						waited.push(ms);
						return Promise.resolve();
					},
				}),
			),
			/done/,
		);
		assert.deepEqual(waited, [300_000, 300_000]);
	});
});
