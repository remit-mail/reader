import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSchedulerLoop, type SchedulerLoopOptions } from "./loop.js";
import type { RunSchedulerTickDeps, SchedulerTickResult } from "./run-tick.js";

const RESULT: SchedulerTickResult = {
	scanned: 0,
	enqueued: 0,
	skipped: 0,
	swept: 0,
	sweepFailed: 0,
};

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

	// The default is the only one production uses, so it is the one a wrong unit
	// or a dropped argument would ship in.
	it("sleeps the real timer when no wait is injected", async () => {
		let rounds = 0;
		const started = Date.now();
		await assert.rejects(
			runSchedulerLoop({
				...buildLoop({
					tickIntervalMs: 25,
					tick: () => {
						rounds += 1;
						return rounds > 2
							? Promise.reject(new Error("done"))
							: Promise.resolve(RESULT);
					},
				}),
				wait: undefined,
			}),
			/done/,
		);
		assert.ok(Date.now() - started >= 50);
	});
});
