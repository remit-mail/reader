import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDeleteFanOut, planGuestFanOut } from "./calendar-scheduling.js";

describe("planGuestFanOut", () => {
	it("sends the revision to every guest still invited and a cancellation to each one removed", () => {
		assert.deepEqual(
			planGuestFanOut(
				["ann@example.com", "bob@example.com"],
				["bob@example.com", "cy@example.com"],
			),
			{
				request: ["bob@example.com", "cy@example.com"],
				cancel: ["ann@example.com"],
			},
		);
	});

	it("invites every guest of a new guest list and cancels nothing", () => {
		assert.deepEqual(planGuestFanOut([], ["ann@example.com"]), {
			request: ["ann@example.com"],
			cancel: [],
		});
	});

	it("cancels every guest when the list is emptied", () => {
		assert.deepEqual(planGuestFanOut(["ann@example.com"], []), {
			request: [],
			cancel: ["ann@example.com"],
		});
	});
});

describe("planDeleteFanOut", () => {
	it("cancels the event for each guest when it is gone", () => {
		assert.deepEqual(
			planDeleteFanOut(true, ["ann@example.com", "ann@example.com"]),
			{
				method: "Cancel",
				recipients: ["ann@example.com"],
			},
		);
	});

	it("sends the shortened series when one occurrence goes", () => {
		assert.deepEqual(planDeleteFanOut(false, ["ann@example.com"]), {
			method: "Request",
			recipients: ["ann@example.com"],
		});
	});
});
