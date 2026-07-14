import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTerminalJobState, nextPollDelayMs } from "./organize-poll";

describe("isTerminalJobState", () => {
	it("stops on Complete and Failed", () => {
		assert.equal(isTerminalJobState("Complete"), true);
		assert.equal(isTerminalJobState("Failed"), true);
	});

	it("keeps polling on Pending and Running", () => {
		assert.equal(isTerminalJobState("Pending"), false);
		assert.equal(isTerminalJobState("Running"), false);
	});

	it("keeps polling while the state is unknown", () => {
		assert.equal(isTerminalJobState(undefined), false);
	});
});

describe("nextPollDelayMs", () => {
	it("backs off exponentially from 1s", () => {
		assert.equal(nextPollDelayMs(0), 1_000);
		assert.equal(nextPollDelayMs(1), 2_000);
		assert.equal(nextPollDelayMs(2), 4_000);
		assert.equal(nextPollDelayMs(3), 8_000);
	});

	it("caps the delay at 15s", () => {
		assert.equal(nextPollDelayMs(10), 15_000);
		assert.equal(nextPollDelayMs(100), 15_000);
	});

	it("treats a negative attempt as the first delay", () => {
		assert.equal(nextPollDelayMs(-5), 1_000);
	});
});
