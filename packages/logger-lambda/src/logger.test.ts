import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { Context } from "aws-lambda";

const addMetric = mock.fn();
const publishStoredMetrics = mock.fn();
const captureColdStartMetric = mock.fn();
const addContext = mock.fn();
const logTrace = mock.fn();
const logDebug = mock.fn();
const logInfo = mock.fn();
const logWarn = mock.fn();
const logError = mock.fn();
const logCritical = mock.fn();
const appendPersistentKeys = mock.fn();

class MockLogger {
	addContext = addContext;
	trace = logTrace;
	debug = logDebug;
	info = logInfo;
	warn = logWarn;
	error = logError;
	critical = logCritical;
	appendPersistentKeys = appendPersistentKeys;
	createChild = () => createChild();
}

const createChild = mock.fn(() => new MockLogger());

class MockMetrics {
	addMetric = addMetric;
	publishStoredMetrics = publishStoredMetrics;
	captureColdStartMetric = captureColdStartMetric;
}

mock.module("@aws-lambda-powertools/logger", {
	namedExports: { Logger: MockLogger },
});

mock.module("@aws-lambda-powertools/metrics", {
	namedExports: {
		Metrics: MockMetrics,
		MetricUnit: { Count: "Count", Milliseconds: "Milliseconds" },
	},
});

const { createLogger, metrics, withTelemetry } = await import("./logger.js");
const { Metrics } = await import("@aws-lambda-powertools/metrics");

type Recorded = { mock: { calls: { arguments: unknown[] }[] } };

const calls = (fn: Recorded): unknown[][] =>
	fn.mock.calls.map((call) => call.arguments);

const lastCall = (fn: Recorded): unknown[] => {
	const recorded = calls(fn);
	assert.ok(recorded.length > 0, "expected the mock to have been called");
	return recorded[recorded.length - 1];
};

const recorded = [
	addMetric,
	publishStoredMetrics,
	captureColdStartMetric,
	addContext,
	logTrace,
	logDebug,
	logInfo,
	logWarn,
	logError,
	logCritical,
	appendPersistentKeys,
	createChild,
];

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

	it("object-first call maps to Powertools message + attributes", () => {
		const log = createLogger(makeContext());
		log.error({ error: "boom", messageId: "m1" }, "Failed to parse message");
		assert.deepEqual(lastCall(logError), [
			"Failed to parse message",
			{ error: "boom", messageId: "m1" },
		]);
	});

	it("object-first call without message uses empty string", () => {
		const log = createLogger();
		log.info({ count: 3 });
		assert.deepEqual(lastCall(logInfo), ["", { count: 3 }]);
	});

	it("string-first call passes message then attributes", () => {
		const log = createLogger();
		log.warn("watch out", { reason: "slow" });
		assert.deepEqual(lastCall(logWarn), ["watch out", { reason: "slow" }]);
	});

	it("string-first call without attributes passes only the message", () => {
		const log = createLogger();
		log.debug("hello");
		assert.deepEqual(lastCall(logDebug), ["hello"]);
	});

	it("fatal maps to Powertools critical", () => {
		const log = createLogger();
		log.fatal({ fatal: true }, "the end");
		assert.deepEqual(lastCall(logCritical), ["the end", { fatal: true }]);
	});

	it("trace maps to Powertools trace", () => {
		const log = createLogger();
		log.trace("trace me");
		assert.deepEqual(lastCall(logTrace), ["trace me"]);
	});

	it("child creates a Powertools child and appends bindings", () => {
		const log = createLogger();
		const child = log.child({ queue: "imap" });
		assert.equal(calls(createChild).length, 1);
		assert.deepEqual(lastCall(appendPersistentKeys), [{ queue: "imap" }]);
		child.info({ done: true }, "child log");
		assert.deepEqual(lastCall(logInfo), ["child log", { done: true }]);
	});

	it("setBindings appends persistent keys", () => {
		const log = createLogger();
		log.setBindings({ requestId: "r1" });
		assert.deepEqual(lastCall(appendPersistentKeys), [{ requestId: "r1" }]);
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
