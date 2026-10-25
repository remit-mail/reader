import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	failingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { AccountAuthType } from "@remit/domain-enums";
import { triggerConfigLoadSyncs } from "./config.js";

/**
 * The credential a password account stores. Its content is never read here —
 * only its presence decides whether a sync is worth enqueuing.
 */
const withPassword = (accountId: string) => ({
	accountId,
	passwordHash: '{"ciphertext":"x"}',
});

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

describe("triggerConfigLoadSyncs", () => {
	it("enqueues a sync for each account and logs success", async () => {
		const queue = recordingQueue();
		const { logger, info, error } = createLoggerSpy();

		await triggerConfigLoadSyncs(
			"config-1",
			[withPassword("acc-a"), withPassword("acc-b")],
			{
				queue: queue,
				logger,
			},
		);

		assert.equal(queue.sent.length, 2);
		assert.equal(info.length, 2);
		assert.equal(error.length, 0);
	});

	it("skips an account that stores no credential (issue #1120)", async () => {
		const queue = recordingQueue();
		const { logger, error } = createLoggerSpy();

		await triggerConfigLoadSyncs(
			"config-1",
			[
				{ accountId: "imported-no-password" },
				withPassword("acc-with-password"),
			],
			{ queue: queue, logger },
		);

		assert.equal(queue.sent.length, 1);
		assert.equal(error.length, 0);
		assert.equal(queue.sent[0]?.body.accountId, "acc-with-password");
	});

	it("skips an OAuth account that stores no refresh token", async () => {
		const queue = recordingQueue();
		const { logger } = createLoggerSpy();

		await triggerConfigLoadSyncs(
			"config-1",
			[
				{
					accountId: "oauth-unconnected",
					authType: AccountAuthType.OauthMicrosoft,
				},
			],
			{ queue: queue, logger },
		);

		assert.equal(queue.sent.length, 0);
	});

	it("does NOT reject when the SQS enqueue fails (read stays resilient)", async () => {
		const econnrefused = Object.assign(new Error(""), {
			name: "AggregateError",
			code: "ECONNREFUSED",
		});
		const { logger } = createLoggerSpy();

		await assert.doesNotReject(
			triggerConfigLoadSyncs("config-1", [withPassword("acc-a")], {
				queue: failingQueue(econnrefused),
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

		await triggerConfigLoadSyncs("config-1", [withPassword("acc-a")], {
			queue: failingQueue(econnrefused),
			logger,
		});

		assert.equal(error.length, 1);
		const call = error[0];
		if (!call) throw new Error("expected an error log");
		assert.equal(call.fields.alert, "sync_trigger_failed");
		assert.equal(call.fields.source, "config_load");
		assert.equal(call.fields.accountId, "acc-a");
		assert.equal(call.fields.accountConfigId, "config-1");
		assert.equal(call.fields.errorName, "AggregateError");
		assert.equal(call.fields.errorCode, "ECONNREFUSED");
	});

	it("isolates failures per account — one bad enqueue does not block the others", async () => {
		const queue = recordingQueue();
		let calls = 0;
		queue.answer(async () => {
			calls += 1;
			if (calls === 1)
				throw Object.assign(new Error(""), { code: "ECONNREFUSED" });
		});
		const { logger, info, error } = createLoggerSpy();

		await triggerConfigLoadSyncs(
			"config-1",
			[withPassword("acc-a"), withPassword("acc-b")],
			{
				queue,
				logger,
			},
		);

		assert.equal(error.length, 1);
		assert.equal(info.length, 1);
		assert.equal(queue.sent.length, 2);
	});

	it("reads SDK error name from the .Code field when present", async () => {
		const sdkError = Object.assign(new Error("boom"), {
			name: "QueueDoesNotExist",
			Code: "AWS.SimpleQueueService.NonExistentQueue",
		});
		const { logger, error } = createLoggerSpy();

		await triggerConfigLoadSyncs("config-1", [withPassword("acc-a")], {
			queue: failingQueue(sdkError),
			logger,
		});

		const call = error[0];
		if (!call) throw new Error("expected an error log");
		assert.equal(
			call.fields.errorCode,
			"AWS.SimpleQueueService.NonExistentQueue",
		);
	});

	// The actual smoke-storm failure mode: GET /config void-fires this trigger
	// (it does not await it), the SQS queue is unreachable, and a concurrent read
	// is in flight on the same event loop. The escaped rejection used to land on
	// that read and 500 it. Assert nothing leaks even when fired exactly that way.
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
			// Fire-and-forget exactly as the getConfig handler does.
			void triggerConfigLoadSyncs(
				"config-1",
				[withPassword("acc-a"), withPassword("acc-b")],
				{
					queue: failingQueue(econnrefused),
					logger,
				},
			);

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
