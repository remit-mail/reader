import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type FireAndForgetLogger, fireAndForget } from "./fire-and-forget.js";

interface LogCall {
	fields: Record<string, unknown>;
	message: string;
}

const createLoggerSpy = () => {
	const error: LogCall[] = [];
	const logger: FireAndForgetLogger = {
		error: (fields: Record<string, unknown>, message: string): void => {
			error.push({ fields, message });
		},
	};
	return { error, logger };
};

describe("fireAndForget", () => {
	it("runs the work and stays quiet on success", async () => {
		const { error, logger } = createLoggerSpy();
		let ran = false;

		await fireAndForget(
			async () => {
				ran = true;
			},
			{ source: "test", message: "should not log", logger },
		);

		assert.equal(ran, true);
		assert.equal(error.length, 0);
	});

	it("does NOT reject when the work throws", async () => {
		const { logger } = createLoggerSpy();

		await assert.doesNotReject(
			fireAndForget(
				async () => {
					throw new Error("boom");
				},
				{ source: "test", message: "contained", logger },
			),
		);
	});

	it("logs the failure loudly with the alertable structured fields and ids", async () => {
		const { error, logger } = createLoggerSpy();
		const econnrefused = Object.assign(new Error(""), {
			name: "AggregateError",
			code: "ECONNREFUSED",
		});

		await fireAndForget(
			async () => {
				throw econnrefused;
			},
			{
				source: "config_load",
				message: "Failed to trigger account sync on config load",
				ids: { accountId: "acc-a", accountConfigId: "config-1" },
				logger,
			},
		);

		assert.equal(error.length, 1);
		const call = error[0];
		if (!call) throw new Error("expected an error log");
		assert.equal(call.fields.alert, "sync_trigger_failed");
		assert.equal(call.fields.source, "config_load");
		assert.equal(call.fields.accountId, "acc-a");
		assert.equal(call.fields.accountConfigId, "config-1");
		assert.equal(call.fields.errorName, "AggregateError");
		assert.equal(call.fields.errorCode, "ECONNREFUSED");
		assert.equal(call.message, "Failed to trigger account sync on config load");
	});

	it("reads the SDK error code from the .Code field when present", async () => {
		const { error, logger } = createLoggerSpy();
		const sdkError = Object.assign(new Error("boom"), {
			name: "QueueDoesNotExist",
			Code: "AWS.SimpleQueueService.NonExistentQueue",
		});

		await fireAndForget(
			async () => {
				throw sdkError;
			},
			{ source: "test", message: "contained", logger },
		);

		const call = error[0];
		if (!call) throw new Error("expected an error log");
		assert.equal(
			call.fields.errorCode,
			"AWS.SimpleQueueService.NonExistentQueue",
		);
	});

	it("never leaks an unhandled rejection even when void-fired", async () => {
		const leaked: unknown[] = [];
		const onUnhandled = (reason: unknown): void => {
			leaked.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);

		try {
			// Fire-and-forget exactly as a request handler does: no await.
			void fireAndForget(
				async () => {
					throw Object.assign(new Error(""), { code: "ECONNREFUSED" });
				},
				{ source: "test", message: "contained", logger: { error: () => {} } },
			);
			// Let the microtask queue drain so any escaped rejection would surface.
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}

		assert.equal(leaked.length, 0);
	});
});
