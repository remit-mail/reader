import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { Context } from "aws-lambda";

// The logging half of this package is covered by log-output.test.ts against its
// real stdout output; this file is the telemetry wrapper, so the logger is
// silenced and only what reaches the metric registry is observed.
process.env.LOG_LEVEL = "silent";

const { withTelemetry } = await import("./logger.js");
const { registry, resetMetrics } = await import("./metrics.js");

type Recorded = { mock: { calls: { arguments: unknown[] }[] } };

const calls = (fn: Recorded): unknown[][] =>
	fn.mock.calls.map((call) => call.arguments);

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

type HistogramValue = {
	metricName?: string;
	labels: Record<string, string | number>;
	value: number;
};

const handlerAggregate = async (
	suffix: string,
	labels: Record<string, string>,
): Promise<number> => {
	const metric = registry.getSingleMetric("remit_handler_duration_seconds");
	assert.ok(metric, "expected the handler duration histogram to be registered");
	const { values } = (await metric.get()) as { values: HistogramValue[] };
	const match = values.find(
		(value) =>
			value.metricName === `remit_handler_duration_seconds_${suffix}` &&
			value.labels.handler === labels.handler &&
			value.labels.outcome === labels.outcome,
	);
	assert.ok(
		match,
		`expected a _${suffix} sample for ${JSON.stringify(labels)}`,
	);
	return match.value;
};

describe("remit-logger-lambda", () => {
	beforeEach(() => resetMetrics());

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

	it("withTelemetry records a failed invocation against the registry", async () => {
		const handler = mock.fn(async () => {
			throw new Error("fail");
		});
		await assert.rejects(withTelemetry(handler)({}, makeContext()));
		const labels = { handler: "test-function", outcome: "failure" };
		assert.equal(await handlerAggregate("count", labels), 1);
	});

	it("withTelemetry records a successful invocation and its duration", async () => {
		const handler = mock.fn(async () => 42);
		await withTelemetry(handler)({}, makeContext());
		const labels = { handler: "test-function", outcome: "success" };
		assert.equal(await handlerAggregate("count", labels), 1);
		assert.equal(typeof (await handlerAggregate("sum", labels)), "number");
	});
});
