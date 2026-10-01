import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type FilterRunReading, filterRunStatus } from "./filter-run";

const reading = (over: Partial<FilterRunReading> = {}): FilterRunReading => ({
	progress: {
		state: undefined,
		matchedCount: 0,
		appliedCount: 0,
		failedCount: 0,
		errorMessage: "",
	},
	failure: undefined,
	isStarting: false,
	isRunning: false,
	isDone: false,
	...over,
});

describe("filterRunStatus (#1354)", () => {
	it("is nothing before a run", () => {
		assert.equal(filterRunStatus(reading()), undefined);
	});

	it("is queuing while the request is out, then running", () => {
		assert.deepEqual(filterRunStatus(reading({ isStarting: true })), {
			kind: "queuing",
		});
		assert.deepEqual(filterRunStatus(reading({ isRunning: true })), {
			kind: "running",
		});
	});

	it("is a failure carrying the worker's reason when the job failed", () => {
		const status = filterRunStatus(
			reading({
				isDone: true,
				progress: {
					state: "Failed",
					matchedCount: 0,
					appliedCount: 0,
					failedCount: 0,
					errorMessage: "This filter is turned off or has expired.",
				},
			}),
		);
		assert.equal(status?.kind, "failed");
		assert.match(
			String(status?.kind === "failed" && (status.error as Error).message),
			/turned off/,
		);
	});

	it("is a failure when the request itself failed", () => {
		const error = new Error("offline");
		assert.deepEqual(
			filterRunStatus(reading({ failure: { kind: "startFailed", error } })),
			{ kind: "failed", error },
		);
	});

	it("is done with the counts of a completed job", () => {
		assert.deepEqual(
			filterRunStatus(
				reading({
					isDone: true,
					progress: {
						state: "Complete",
						matchedCount: 4,
						appliedCount: 3,
						failedCount: 1,
						errorMessage: "",
					},
				}),
			),
			{ kind: "done", matched: 4, applied: 3 },
		);
	});
});
