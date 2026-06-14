import type { Context } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPublishStoredMetrics = vi.fn();
const mockAddMetric = vi.fn();
const mockCaptureColdStartMetric = vi.fn();
const mockAddContext = vi.fn();
const mockLogTrace = vi.fn();
const mockLogDebug = vi.fn();
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogError = vi.fn();
const mockLogCritical = vi.fn();
const mockAppendPersistentKeys = vi.fn();
const mockCreateChild = vi.fn();

vi.mock("@aws-lambda-powertools/metrics", () => {
	class MockMetrics {
		addMetric = mockAddMetric;
		publishStoredMetrics = mockPublishStoredMetrics;
		captureColdStartMetric = mockCaptureColdStartMetric;
	}

	return {
		Metrics: MockMetrics,
		MetricUnit: {
			Count: "Count",
			Milliseconds: "Milliseconds",
		},
	};
});

vi.mock("@aws-lambda-powertools/logger", () => {
	class MockLogger {
		addContext = mockAddContext;
		trace = mockLogTrace;
		debug = mockLogDebug;
		info = mockLogInfo;
		warn = mockLogWarn;
		error = mockLogError;
		critical = mockLogCritical;
		appendPersistentKeys = mockAppendPersistentKeys;
		createChild = mockCreateChild;
	}

	return { Logger: MockLogger };
});

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
		done: vi.fn(),
		fail: vi.fn(),
		succeed: vi.fn(),
	}) as unknown as Context;

describe("remit-logger-lambda", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateChild.mockImplementation(() => {
			const child = {
				trace: mockLogTrace,
				debug: mockLogDebug,
				info: mockLogInfo,
				warn: mockLogWarn,
				error: mockLogError,
				critical: mockLogCritical,
				appendPersistentKeys: mockAppendPersistentKeys,
				createChild: mockCreateChild,
			};
			return child;
		});
	});

	it("exports metrics as a Metrics instance", async () => {
		const { metrics } = await import("./logger.js");
		const { Metrics } = await import("@aws-lambda-powertools/metrics");
		expect(metrics).toBeInstanceOf(Metrics);
	});

	it("object-first call maps to Powertools message + attributes", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger(makeContext());
		log.error({ error: "boom", messageId: "m1" }, "Failed to parse message");
		expect(mockLogError).toHaveBeenCalledWith("Failed to parse message", {
			error: "boom",
			messageId: "m1",
		});
	});

	it("object-first call without message uses empty string", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		log.info({ count: 3 });
		expect(mockLogInfo).toHaveBeenCalledWith("", { count: 3 });
	});

	it("string-first call passes message then attributes", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		log.warn("watch out", { reason: "slow" });
		expect(mockLogWarn).toHaveBeenCalledWith("watch out", { reason: "slow" });
	});

	it("string-first call without attributes passes only the message", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		log.debug("hello");
		expect(mockLogDebug).toHaveBeenCalledWith("hello");
	});

	it("fatal maps to Powertools critical", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		log.fatal({ fatal: true }, "the end");
		expect(mockLogCritical).toHaveBeenCalledWith("the end", { fatal: true });
	});

	it("trace maps to Powertools trace", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		log.trace("trace me");
		expect(mockLogTrace).toHaveBeenCalledWith("trace me");
	});

	it("child creates a Powertools child and appends bindings", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		const child = log.child({ queue: "imap" });
		expect(mockCreateChild).toHaveBeenCalledOnce();
		expect(mockAppendPersistentKeys).toHaveBeenCalledWith({ queue: "imap" });
		child.info({ done: true }, "child log");
		expect(mockLogInfo).toHaveBeenCalledWith("child log", { done: true });
	});

	it("setBindings appends persistent keys", async () => {
		const { createLogger } = await import("./logger.js");
		const log = createLogger();
		log.setBindings({ requestId: "r1" });
		expect(mockAppendPersistentKeys).toHaveBeenCalledWith({ requestId: "r1" });
	});

	it("withTelemetry calls the handler and returns its result", async () => {
		const { withTelemetry } = await import("./logger.js");
		const handler = vi.fn().mockResolvedValue("hello");
		const wrapped = withTelemetry(handler);
		const result = await wrapped({ key: "value" }, makeContext());
		expect(result).toBe("hello");
		expect(handler).toHaveBeenCalledOnce();
	});

	it("withTelemetry re-throws handler errors", async () => {
		const { withTelemetry } = await import("./logger.js");
		const boom = new Error("boom");
		const handler = vi.fn().mockRejectedValue(boom);
		const wrapped = withTelemetry(handler);
		await expect(wrapped({}, makeContext())).rejects.toThrow("boom");
	});

	it("withTelemetry publishes metrics in finally even on error", async () => {
		const { withTelemetry } = await import("./logger.js");
		const handler = vi.fn().mockRejectedValue(new Error("fail"));
		const wrapped = withTelemetry(handler);
		await expect(wrapped({}, makeContext())).rejects.toThrow();
		expect(mockPublishStoredMetrics).toHaveBeenCalled();
	});

	it("withTelemetry emits errorCount on handler failure", async () => {
		const { withTelemetry } = await import("./logger.js");
		const handler = vi.fn().mockRejectedValue(new Error("fail"));
		const wrapped = withTelemetry(handler);
		await expect(wrapped({}, makeContext())).rejects.toThrow();
		expect(mockAddMetric).toHaveBeenCalledWith("errorCount", "Count", 1);
	});

	it("withTelemetry emits invocationCount and invocationLatency on success", async () => {
		const { withTelemetry } = await import("./logger.js");
		const handler = vi.fn().mockResolvedValue(42);
		const wrapped = withTelemetry(handler);
		await wrapped({}, makeContext());
		expect(mockAddMetric).toHaveBeenCalledWith("invocationCount", "Count", 1);
		expect(mockAddMetric).toHaveBeenCalledWith(
			"invocationLatency",
			"Milliseconds",
			expect.any(Number),
		);
	});
});
