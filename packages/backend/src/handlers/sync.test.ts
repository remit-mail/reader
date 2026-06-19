import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { triggerSyncSafe } from "./sync.js";

const QUEUE_URL = "http://localhost:9324/000000000000/remit-dev-mailboxes";

interface LogCall {
	fields: Record<string, unknown>;
	message: string;
}

const createLoggerSpy = () => {
	const info: LogCall[] = [];
	const error: LogCall[] = [];
	const logger = {
		info: (fields: Record<string, unknown>, message: string): void => {
			info.push({ fields, message });
		},
		error: (fields: Record<string, unknown>, message: string): void => {
			error.push({ fields, message });
		},
	};
	return { info, error, logger };
};

const okSqsClient = (sent: SendMessageCommand[]): SQSClient =>
	({
		send: async (cmd: SendMessageCommand) => {
			sent.push(cmd);
			return {};
		},
	}) as unknown as SQSClient;

/**
 * Reproduces the real smoke failure shape: the SQS send does NOT reject inline —
 * it rejects on a later microtask/timer, the way a socket ECONNREFUSED settles
 * after the AWS SDK's connect + retries. A try/catch that only guards the
 * synchronous call would miss it; only awaiting the actual promise contains it.
 */
const deferredFailingSqsClient = (error: Error): SQSClient =>
	({
		send: () =>
			new Promise((_resolve, reject) => {
				setImmediate(() => reject(error));
			}),
	}) as unknown as SQSClient;

describe("triggerSyncSafe", () => {
	it("enqueues a SYNC_MAILBOXES event and logs success", async () => {
		const sent: SendMessageCommand[] = [];
		const { logger, info, error } = createLoggerSpy();

		await triggerSyncSafe("acc-a", "config-1", {
			sqsClient: okSqsClient(sent),
			queueUrl: QUEUE_URL,
			logger,
		});

		assert.equal(sent.length, 1);
		assert.equal(info.length, 1);
		assert.equal(error.length, 0);
	});

	it("does NOT reject when the SQS enqueue fails (POST /sync stays resilient)", async () => {
		const econnrefused = Object.assign(new Error(""), {
			name: "AggregateError",
			code: "ECONNREFUSED",
		});
		const { logger } = createLoggerSpy();

		await assert.doesNotReject(
			triggerSyncSafe("acc-a", "config-1", {
				sqsClient: deferredFailingSqsClient(econnrefused),
				queueUrl: QUEUE_URL,
				logger,
			}),
		);
	});

	it("logs the failure loudly with the alertable structured fields", async () => {
		const econnrefused = Object.assign(new Error(""), {
			name: "AggregateError",
			code: "ECONNREFUSED",
		});
		const { logger, error } = createLoggerSpy();

		await triggerSyncSafe("acc-a", "config-1", {
			sqsClient: deferredFailingSqsClient(econnrefused),
			queueUrl: QUEUE_URL,
			logger,
		});

		assert.equal(error.length, 1);
		const call = error[0];
		if (!call) throw new Error("expected an error log");
		assert.equal(call.fields.alert, "sync_trigger_failed");
		assert.equal(call.fields.source, "trigger_sync");
		assert.equal(call.fields.accountId, "acc-a");
		assert.equal(call.fields.accountConfigId, "config-1");
		assert.equal(call.fields.errorCode, "ECONNREFUSED");
	});

	// The actual smoke-storm failure mode #746/#753 missed: POST /sync void-fires
	// this trigger, the queue is unreachable, and a concurrent read is in flight on
	// the same event loop. Before containment the escaped rejection landed on that
	// read and 500'd it. The SQS send here rejects on a LATER tick (a real socket
	// error never settles inline), which is exactly why a synchronous-only guard
	// did not reproduce the failure. Assert nothing leaks onto the concurrent read.
	it("void-fired with an unreachable queue leaks NO unhandled rejection onto a concurrent read", async () => {
		const leaked: unknown[] = [];
		const onUnhandled = (reason: unknown): void => {
			leaked.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);

		const econnrefused = Object.assign(new Error(""), {
			name: "AggregateError",
			code: "ECONNREFUSED",
		});
		const { logger } = createLoggerSpy();

		let readResolved = false;
		try {
			// Fire-and-forget exactly as SyncOperations_triggerSync does.
			void triggerSyncSafe("acc-a", "config-1", {
				sqsClient: deferredFailingSqsClient(econnrefused),
				queueUrl: QUEUE_URL,
				logger,
			});

			// A concurrent "read" sharing the event loop, like /mailboxes or /outbox.
			await new Promise((resolve) => setImmediate(resolve)).then(() => {
				readResolved = true;
			});
			// Drain remaining microtasks so any escaped rejection would surface.
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}

		assert.equal(readResolved, true);
		assert.equal(leaked.length, 0);
	});
});
