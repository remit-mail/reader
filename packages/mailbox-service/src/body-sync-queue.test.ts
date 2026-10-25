import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { BodySyncQueueService } from "./body-sync-queue.js";
import {
	type RecordingQueue,
	recordingQueue,
} from "./test-helpers/test-store.js";

let capture: RecordingQueue;
let errors: Array<[Record<string, unknown>, string]>;

beforeEach(() => {
	capture = recordingQueue();
	errors = [];
});

const request = (uid?: number) =>
	new BodySyncQueueService({
		queue: capture,
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
	it("asks for a forced re-sync of the message and its uid", async () => {
		await request(42);

		const event = capture.sent[0].body;
		assert.equal(event.type, "SYNC_MESSAGE_BODY");
		assert.deepEqual(event.messageIds, ["msg-1"]);
		assert.deepEqual(event.messages, [{ messageId: "msg-1", uid: 42 }]);
		assert.equal(event.force, true);
		assert.equal(capture.sent[0].groupId, undefined);
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
