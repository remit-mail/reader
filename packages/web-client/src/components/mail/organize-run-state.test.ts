/**
 * A back-apply job reports two things that used to arrive as one error flag: it
 * never started, or its status could not be read (#526). The run screen is only
 * allowed to say nothing happened for the first.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type OrganizeJobReading,
	organizeRunState,
} from "./organize-run-state";

const reading = (
	over: Partial<OrganizeJobReading> = {},
): OrganizeJobReading => ({
	failure: undefined,
	isStarting: false,
	isRunning: false,
	isDone: false,
	failedCount: 0,
	ruleSaved: false,
	...over,
});

describe("organizeRunState", () => {
	it("keeps a running job running when a status poll could not be read", () => {
		const state = organizeRunState(
			reading({
				isRunning: true,
				failure: { kind: "statusUnreadable", error: new Error("offline") },
			}),
		);
		assert.equal(state, "statusUnknown");
		assert.notEqual(state, "commitFailed");
	});

	it("keeps a finished job finished when a later poll fails", () => {
		// Polling stops on a terminal state, so the failing read is a window-focus
		// refetch over a job that already reported its counts.
		assert.equal(
			organizeRunState(
				reading({
					isDone: true,
					failure: { kind: "statusUnreadable", error: new Error("offline") },
				}),
			),
			"backApplyComplete",
		);
		assert.equal(
			organizeRunState(
				reading({
					isDone: true,
					failedCount: 3,
					failure: { kind: "statusUnreadable", error: new Error("offline") },
				}),
			),
			"backApplyFailed",
		);
	});

	it("keeps a finished pass's ending when the retry over it could not be started", () => {
		// #552: the retry is a second create, and a create that failed over a pass
		// that already moved mail is not a pass that never ran.
		for (const ruleSaved of [true, false]) {
			assert.equal(
				organizeRunState(
					reading({
						ruleSaved,
						isDone: true,
						failedCount: 84,
						failure: { kind: "restartFailed", error: new Error("offline") },
					}),
				),
				"backApplyRestartFailed",
			);
		}
	});

	it("says nothing happened only when the create itself failed", () => {
		assert.equal(
			organizeRunState(
				reading({ failure: { kind: "startFailed", error: new Error("nope") } }),
			),
			"commitFailed",
		);
	});

	it("leaves a saved rule standing when its pass never started", () => {
		assert.equal(
			organizeRunState(
				reading({
					ruleSaved: true,
					failure: { kind: "startFailed", error: new Error("nope") },
				}),
			),
			"backApplyStartFailed",
		);
	});

	it("reports a job that is starting or polling cleanly as running", () => {
		assert.equal(
			organizeRunState(reading({ isStarting: true })),
			"backApplyRunning",
		);
		assert.equal(
			organizeRunState(reading({ isRunning: true })),
			"backApplyRunning",
		);
	});

	it("has nothing to report before a commit", () => {
		assert.equal(organizeRunState(reading()), "saving");
	});
});
