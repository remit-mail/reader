import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getRecentErrors } from "./console-errors";
import {
	__resetFatalError,
	getCurrentFatalError,
	reportFatalError,
	setFatalErrorTelemetry,
	subscribeFatalError,
} from "./fatal-error";

afterEach(() => {
	__resetFatalError();
});

describe("reportFatalError", () => {
	it("notifies subscribers with the classified fatal", () => {
		const seen: string[] = [];
		subscribeFatalError((fatal) => seen.push(fatal.message));

		reportFatalError(new Error("server exploded"));

		assert.deepEqual(seen, ["server exploded"]);
	});

	it("records the fatal into the recent-errors ring (bug-report flow reads it)", () => {
		reportFatalError(new Error("ring me"));
		const recent = getRecentErrors();
		assert.ok(
			recent.some((line) => line.includes("Fatal: ring me")),
			"expected the fatal to land in the console-errors ring",
		);
	});

	it("assigns a correlation id and exposes the current fatal", () => {
		const fatal = reportFatalError(new Error("with id"));
		assert.ok(fatal.correlationId.length > 0);
		assert.equal(getCurrentFatalError(), fatal);
	});

	it("emits a telemetry fatal-error event through the registered sink", () => {
		const recorded: Array<{ message: string; ctx?: Record<string, string> }> =
			[];
		setFatalErrorTelemetry({
			recordPageView: () => {},
			recordError: (error, ctx) =>
				recorded.push({ message: error.message, ctx }),
			recordEvent: () => {},
			recordTiming: () => {},
		});

		reportFatalError(new Error("telemetry please"));

		assert.equal(recorded.length, 1);
		assert.equal(recorded[0].message, "telemetry please");
		assert.equal(recorded[0].ctx?.fatal, "true");
	});

	it("unsubscribe stops further notifications", () => {
		let count = 0;
		const unsubscribe = subscribeFatalError(() => {
			count += 1;
		});
		reportFatalError(new Error("one"));
		unsubscribe();
		reportFatalError(new Error("two"));
		assert.equal(count, 1);
	});
});
