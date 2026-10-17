import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BodySyncQueueService } from "./body-sync-queue.js";
import { captureQueue, type QueueCapture } from "./test-helpers/test-store.js";

let capture: QueueCapture;
let errors: Array<[Record<string, unknown>, string]>;

beforeEach(() => {
	capture = captureQueue();
	errors = [];
});

afterEach(() => capture.restore());

const request = (uid?: number) =>
	new BodySyncQueueService({
		sqsQueueUrl: "http://localhost:9324/000/remit-body",
		logger: {
			info: () => {},
			error: (obj, msg) => {
				errors.push([obj, msg]);
			},
		},
	}).requestBodySync({
		accountId: "acc-1",
		mailboxId: "mbx-1",
		messageId: "msg-1",
		...(uid === undefined ? {} : { uid }),
	});

describe("BodySyncQueueService.requestBodySync", () => {
	it("asks for a forced re-sync of the message and its uid on a standard queue", async () => {
		await request(42);

		const [input] = capture.inputs();
		const event = JSON.parse(input.MessageBody ?? "{}");
		assert.equal(event.type, "SYNC_MESSAGE_BODY");
		assert.deepEqual(event.messageIds, ["msg-1"]);
		assert.deepEqual(event.messages, [{ messageId: "msg-1", uid: 42 }]);
		assert.equal(event.force, true);
		assert.equal(input.MessageGroupId, undefined);
	});

	it("omits the uid pair when no uid is known", async () => {
		await request();

		assert.equal(capture.sent[0].body.messages, undefined);
	});

	it("never rejects when the queue is down, and raises an alertable error", async () => {
		capture.answer(async () => {
			throw new Error("queue down");
		});

		await assert.doesNotReject(request());

		assert.equal(errors.length, 1);
		const [fields, message] = errors[0];
		assert.equal(fields.alert, "body_sync_cue_enqueue_failed");
		assert.equal(fields.messageId, "msg-1");
		assert.match(message, /read path returned a retryable 202/);
	});
});
