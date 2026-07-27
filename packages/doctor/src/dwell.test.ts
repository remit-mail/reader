import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advance } from "./dwell.js";
import { type DoctorState, initialState } from "./state.js";
import type { Verdict } from "./verdict.js";

const NOW = new Date("2026-07-27T10:00:00.000Z");

/** Feed a run of verdicts through the machine and collect what it announced. */
const run = (
	verdicts: readonly Verdict[],
	dwell = 3,
	from: DoctorState = initialState,
): { fired: (Verdict | undefined)[]; state: DoctorState } => {
	let state = from;
	const fired: (Verdict | undefined)[] = [];
	for (const verdict of verdicts) {
		const transition = advance(state, verdict, dwell, NOW);
		state = transition.state;
		fired.push(transition.fires);
	}
	return { fired, state };
};

describe("the dwell rule", () => {
	it("says nothing on a healthy stack, however long it stays healthy", () => {
		const { fired } = run([
			"healthy",
			"healthy",
			"healthy",
			"healthy",
			"healthy",
		]);
		assert.deepEqual(fired, [
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});

	it("announces a degraded verdict once, on the third agreeing check", () => {
		const { fired } = run(["degraded", "degraded", "degraded", "degraded"]);
		assert.deepEqual(fired, [undefined, undefined, "degraded", undefined]);
	});

	it("announces the recovery once, three checks later", () => {
		const { fired } = run([
			"degraded",
			"degraded",
			"degraded",
			"healthy",
			"healthy",
			"healthy",
			"healthy",
		]);
		assert.deepEqual(fired, [
			undefined,
			undefined,
			"degraded",
			undefined,
			undefined,
			"healthy",
			undefined,
		]);
	});

	it("stays silent through a flap that never settles", () => {
		const { fired } = run([
			"degraded",
			"healthy",
			"degraded",
			"healthy",
			"degraded",
			"healthy",
			"degraded",
			"healthy",
		]);
		assert.deepEqual(new Set(fired), new Set([undefined]));
	});

	it("stays silent when a degraded run is broken one check short", () => {
		const { fired } = run(["degraded", "degraded", "healthy", "degraded"]);
		assert.deepEqual(fired, [undefined, undefined, undefined, undefined]);
	});

	it("does not re-announce a condition already reported", () => {
		const first = run(["degraded", "degraded", "degraded"]);
		const second = run(
			["degraded", "degraded", "degraded", "degraded"],
			3,
			first.state,
		);
		assert.deepEqual(new Set(second.fired), new Set([undefined]));
	});

	it("survives a restart without re-announcing, because the state is the input", () => {
		const before = run(["degraded", "degraded", "degraded"]).state;
		// A restart reloads exactly this state from the volume.
		const after = run(["degraded", "degraded", "degraded"], 3, before);
		assert.deepEqual(new Set(after.fired), new Set([undefined]));
		assert.equal(after.state.firedVerdict, "degraded");
	});

	it("holds the run at the dwell count rather than counting up forever", () => {
		const { state } = run(new Array(50).fill("healthy"));
		assert.equal(state.candidateRuns, 3);
	});

	it("honours a shorter dwell", () => {
		const { fired } = run(["degraded", "degraded"], 1);
		assert.deepEqual(fired, ["degraded", undefined]);
	});

	it("stamps when it last decided", () => {
		const { state } = run(["healthy"]);
		assert.equal(state.updatedAt, NOW.toISOString());
	});
});
