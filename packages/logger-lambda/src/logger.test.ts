import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { Context } from "aws-lambda";

// The logging half of this package is covered by log-output.test.ts against its
// real stdout output; this file is the telemetry wrapper, so the logger is
// silenced and only the metric calls are observed.
process.env.LOG_LEVEL = "silent";

const addMetric = mock.fn();
const publishStoredMetrics = mock.fn();
const captureColdStartMetric = mock.fn();

class MockMetrics {
	addMetric = addMetric;
	publishStoredMetrics = publishStoredMetrics;
	captureColdStartMetric = captureColdStartMetric;
}

mock.module("@aws-lambda-powertools/metrics", {
	namedExports: {
		Metrics: MockMetrics,
		MetricUnit: { Count: "Count", Milliseconds: "Milliseconds" },
	},
});

const { metrics, withTelemetry } = await import("./logger.js");
const { Metrics } = await import("@aws-lambda-powertools/metrics");

type Recorded = { mock: { calls: { arguments: unknown[] }[] } };

const calls = (fn: Recorded): unknown[][] =>
	fn.mock.calls.map((call) => call.arguments);

const recorded = [addMetric, publishStoredMetrics, captureColdStartMetric];

const makeContext = (): Context =>
	({
		awsRequestId: "test-request-id",
		functionName: "test-function",
		invokedFunctionArn: "arn:aws:lambda:us-east-1:123:function:test",
		memoryLimitInMB: "128",
		logGroupName: "/aws/lambda/test",
		logStreamName: "test-stream",
		getRemainingTimeInMillis: () => 30000,
		callbackWaitsForEmptyEventLoop: false,
		functionVersion: "$LATEST",
		done: () => {},
		fail: () => {},
		succeed: () => {},
	}) as unknown as Context;

describe("remit-logger-lambda", () => {
	beforeEach(() => {
		for (const fn of recorded) fn.mock.resetCalls();
	});

	it("exports metrics as a Metrics instance", () => {
		assert.ok(metrics instanceof Metrics);
	});

	it("withTelemetry calls the handler and returns its result", async () => {
		const handler = mock.fn(async () => "hello");
		const wrapped = withTelemetry(handler);
		const result = await wrapped({ key: "value" }, makeContext());
		assert.equal(result, "hello");
		assert.equal(calls(handler).length, 1);
	});

	it("withTelemetry re-throws handler errors", async () => {
		const handler = mock.fn(async () => {
			throw new Error("boom");
		});
		const wrapped = withTelemetry(handler);
		await assert.rejects(wrapped({}, makeContext()), /boom/);
	});

	it("withTelemetry publishes metrics in finally even on error", async () => {
		const handler = mock.fn(async () => {
			throw new Error("fail");
		});
		const wrapped = withTelemetry(handler);
		await assert.rejects(wrapped({}, makeContext()));
		assert.ok(calls(publishStoredMetrics).length > 0);
	});

	it("withTelemetry emits errorCount on handler failure", async () => {
		const handler = mock.fn(async () => {
			throw new Error("fail");
		});
		const wrapped = withTelemetry(handler);
		await assert.rejects(wrapped({}, makeContext()));
		assert.deepEqual(calls(addMetric), [["errorCount", "Count", 1]]);
	});

	it("withTelemetry emits invocationCount and invocationLatency on success", async () => {
		const handler = mock.fn(async () => 42);
		const wrapped = withTelemetry(handler);
		await wrapped({}, makeContext());
		const [countCall, latencyCall] = calls(addMetric);
		assert.deepEqual(countCall, ["invocationCount", "Count", 1]);
		assert.deepEqual(latencyCall.slice(0, 2), [
			"invocationLatency",
			"Milliseconds",
		]);
		assert.equal(typeof latencyCall[2], "number");
	});
});
