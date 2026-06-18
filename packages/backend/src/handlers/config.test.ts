import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { triggerConfigLoadSyncs } from "./config.js";

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

const failingSqsClient = (error: Error): SQSClient =>
	({
		send: async () => {
			throw error;
		},
	}) as unknown as SQSClient;

describe("triggerConfigLoadSyncs", () => {
	it("enqueues a sync for each account and logs success", async () => {
		const sent: SendMessageCommand[] = [];
		const { logger, info, error } = createLoggerSpy();

		await triggerConfigLoadSyncs("config-1", ["acc-a", "acc-b"], {
			sqsClient: okSqsClient(sent),
			queueUrl: QUEUE_URL,
			logger,
		});

		assert.equal(sent.length, 2);
		assert.equal(info.length, 2);
		assert.equal(error.length, 0);
	});

	it("does NOT reject when the SQS enqueue fails (read stays resilient)", async () => {
		const econnrefused = Object.assign(new Error(""), {
			name: "AggregateError",
			code: "ECONNREFUSED",
		});
		const { logger } = createLoggerSpy();

		await assert.doesNotReject(
			triggerConfigLoadSyncs("config-1", ["acc-a"], {
				sqsClient: failingSqsClient(econnrefused),
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

		await triggerConfigLoadSyncs("config-1", ["acc-a"], {
			sqsClient: failingSqsClient(econnrefused),
			queueUrl: QUEUE_URL,
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
		const sent: SendMessageCommand[] = [];
		let calls = 0;
		const sqsClient = {
			send: async (cmd: SendMessageCommand) => {
				calls += 1;
				if (calls === 1)
					throw Object.assign(new Error(""), { code: "ECONNREFUSED" });
				sent.push(cmd);
				return {};
			},
		} as unknown as SQSClient;
		const { logger, info, error } = createLoggerSpy();

		await triggerConfigLoadSyncs("config-1", ["acc-a", "acc-b"], {
			sqsClient,
			queueUrl: QUEUE_URL,
			logger,
		});

		assert.equal(error.length, 1);
		assert.equal(info.length, 1);
		assert.equal(sent.length, 1);
	});

	it("reads SDK error name from the .Code field when present", async () => {
		const sdkError = Object.assign(new Error("boom"), {
			name: "QueueDoesNotExist",
			Code: "AWS.SimpleQueueService.NonExistentQueue",
		});
		const { logger, error } = createLoggerSpy();

		await triggerConfigLoadSyncs("config-1", ["acc-a"], {
			sqsClient: failingSqsClient(sdkError),
			queueUrl: QUEUE_URL,
			logger,
		});

		const call = error[0];
		if (!call) throw new Error("expected an error log");
		assert.equal(
			call.fields.errorCode,
			"AWS.SimpleQueueService.NonExistentQueue",
		);
	});
});
