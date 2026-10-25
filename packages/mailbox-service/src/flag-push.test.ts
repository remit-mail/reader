import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { MessageSystemFlag } from "@remit/domain-enums";
import { FlagPushService } from "./flag-push.js";
import {
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
} from "./test-helpers/test-store.js";

const target = {
	accountId: "acc-1",
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	mailboxId: "mbx-1",
	flagName: MessageSystemFlag.Seen,
	operation: "add" as const,
};

let store: Store;
let capture: RecordingQueue;
let errors: Array<Record<string, unknown>>;

beforeEach(async () => {
	store = await openStore();
	capture = recordingQueue();
	errors = [];
});

afterEach(async () => {
	await store.close();
});

const queueAnswers = (answer: () => Promise<unknown>) => capture.answer(answer);

const flips = () =>
	new FlagPushService({
		markerService: store.flagPush,
		queue: capture,
		logger: {
			info: () => {},
			error: (fields: Record<string, unknown>) => errors.push(fields),
		},
	});

const marker = () => store.flagPush.find(target.messageId, target.flagName);

describe("FlagPushService.flip", () => {
	it("records the owed push and marks it queued once the hint is sent", async () => {
		queueAnswers(async () => ({}));

		await flips().flip(target);

		const recorded = await marker();
		assert.equal(recorded?.operation, "add");
		assert.equal(recorded?.mailboxId, target.mailboxId);
		assert.equal(recorded?.state, "queued");
	});

	it("names the message and flag in the hint, never the operation or a uid", async () => {
		queueAnswers(async () => ({}));

		await flips().flip(target);

		const event = capture.sent[0].body;
		assert.equal(event.type, "FLAG_PUSH");
		assert.equal(event.messageId, target.messageId);
		assert.equal(event.flagName, target.flagName);
		assert.equal("operation" in event, false);
		assert.equal("uid" in event, false);
	});

	it("groups the hint by account and deduplicates it by its own event id", async () => {
		queueAnswers(async () => ({}));

		await flips().flip(target);

		const [sent] = capture.sent;
		assert.equal(sent.groupId, target.accountId);
		assert.equal(sent.deduplicationId, capture.sent[0].body.eventId);
	});

	it("keeps the push owed and alarms, without rejecting, when the queue is down", async () => {
		queueAnswers(async () => {
			throw Object.assign(new Error("connect ECONNREFUSED"), {
				code: "ECONNREFUSED",
			});
		});

		await flips().flip(target);

		assert.equal((await marker())?.state, "pending");
		const alarm = errors.find(
			(entry) => entry.alert === "flag_push_hint_enqueue_failed",
		);
		assert.equal(alarm?.errorCode, "ECONNREFUSED");
	});

	it("raises no alarm when the worker drained the push before it was marked queued", async () => {
		queueAnswers(async () => {
			await store.flagPush.delete(target.messageId, target.flagName);
			return {};
		});

		await flips().flip(target);

		assert.equal(await marker(), null);
		assert.deepEqual(errors, []);
	});
});
