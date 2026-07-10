import assert from "node:assert";
import { describe, it, mock } from "node:test";
import {
	type BodySyncQueueLogger,
	BodySyncQueueService,
} from "./body-sync-queue.js";

interface CapturedInput {
	QueueUrl: string;
	MessageBody: string;
	MessageGroupId?: string;
	MessageDeduplicationId?: string;
}

const buildService = (
	overrides: {
		sqsQueueUrl?: string;
		send?: (command: { input: CapturedInput }) => Promise<unknown>;
		logger?: BodySyncQueueLogger;
	} = {},
) => {
	const sent: CapturedInput[] = [];
	const send = mock.fn(
		overrides.send ??
			(async (command: { input: CapturedInput }) => {
				sent.push(command.input);
				return { MessageId: "id" };
			}),
	);
	const service = new BodySyncQueueService({
		sqsQueueUrl:
			overrides.sqsQueueUrl ?? "http://localhost:9324/000/remit-body",
		logger: overrides.logger,
	});
	// @ts-expect-error - inject mock SQS client for the test
	service.sqs = { send };
	return { service, send, sent };
};

describe("BodySyncQueueService.requestBodySync", () => {
	it("emits a SYNC_MESSAGE_BODY event with the message id and uid pair", async () => {
		const { service, send, sent } = buildService();

		await service.requestBodySync({
			accountId: "acc-1",
			mailboxId: "mbx-1",
			messageId: "msg-1",
			uid: 42,
		});

		assert.equal(send.mock.calls.length, 1);
		const event = JSON.parse(sent[0].MessageBody);
		assert.equal(event.type, "SYNC_MESSAGE_BODY");
		assert.equal(event.accountId, "acc-1");
		assert.equal(event.mailboxId, "mbx-1");
		assert.deepEqual(event.messageIds, ["msg-1"]);
		assert.deepEqual(event.messages, [{ messageId: "msg-1", uid: 42 }]);
		// The worker's skip guard must be bypassed for this message — a read
		// miss already proved bodyStorageKey is stale.
		assert.equal(event.force, true);
		// A standard queue must not carry FIFO parameters.
		assert.equal(sent[0].MessageGroupId, undefined);
	});

	it("omits the uid pair when no uid is known", async () => {
		const { service, sent } = buildService();

		await service.requestBodySync({
			accountId: "acc-1",
			mailboxId: "mbx-1",
			messageId: "msg-1",
		});

		const event = JSON.parse(sent[0].MessageBody);
		assert.deepEqual(event.messageIds, ["msg-1"]);
		assert.equal(event.messages, undefined);
	});

	it("never rejects when the queue send fails — the read path already returned 202", async () => {
		const { service } = buildService({
			send: async () => {
				throw new Error("queue down");
			},
		});

		await assert.doesNotReject(() =>
			service.requestBodySync({
				accountId: "acc-1",
				mailboxId: "mbx-1",
				messageId: "msg-1",
			}),
		);
	});

	it("logs an alertable body_sync_cue_enqueue_failed error instead of rejecting — the swallow is not silent operationally, only silent to the caller (RFC 033 D5)", async () => {
		const errorCalls: Array<[Record<string, unknown>, string]> = [];
		const logger: BodySyncQueueLogger = {
			info: () => {},
			error: (obj, msg) => {
				errorCalls.push([obj, msg]);
			},
		};
		const { service } = buildService({
			send: async () => {
				throw new Error("queue down");
			},
			logger,
		});

		await service.requestBodySync({
			accountId: "acc-1",
			mailboxId: "mbx-1",
			messageId: "msg-1",
		});

		assert.equal(errorCalls.length, 1);
		const [fields, message] = errorCalls[0];
		assert.equal(fields.alert, "body_sync_cue_enqueue_failed");
		assert.equal(fields.accountId, "acc-1");
		assert.equal(fields.mailboxId, "mbx-1");
		assert.equal(fields.messageId, "msg-1");
		assert.match(message, /read path returned a retryable 202/);
	});
});
