import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, OutboxMessageItem } from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { OutboxMessageStatus } from "@remit/domain-enums";
import { OutboxAttachmentService } from "./outbox-attachment.js";
import { OutboxQueueService } from "./outbox-queue.js";
import {
	beforeNext,
	captureQueue,
	openStore,
	type QueueCapture,
	type QueuedEvent,
	type Store,
	seedAccount,
} from "./test-helpers/test-store.js";

let store: Store;
let account: AccountItem;
let capture: QueueCapture;
let enqueued: QueuedEvent[];
let enqueueFails: Error | undefined;
let whileEnqueueing: () => Promise<unknown>;

beforeEach(async () => {
	store = await openStore();
	account = await seedAccount(store);
	enqueueFails = undefined;
	whileEnqueueing = async () => {};
	capture = captureQueue();
	capture.answer(async () => {
		await whileEnqueueing();
		if (enqueueFails) throw enqueueFails;
		return {};
	});
	enqueued = capture.sent;
});

afterEach(async () => {
	capture.restore();
	await store.close();
});

const queue = () =>
	new OutboxQueueService({
		outboxMessageService: store.outboxMessage,
		outboxAttachmentService: new OutboxAttachmentService({
			outboxMessageService: store.outboxMessage,
			outboxAttachmentService: store.outboxAttachment,
			storage: store.storage(),
		}),
		accountService: store.account,
		sqsSmtpQueueUrl: "http://localhost/queue",
	});

const message = (status: OutboxMessageItem["status"]) =>
	store.outboxMessage.create({
		accountId: account.accountId,
		accountConfigId: account.accountConfigId,
		fromAddress: "me@example.com",
		toAddresses: ["typo@exmaple.com"],
		messageIdValue: "<m1@example.com>",
		subject: "Invoice",
		textBody: "Attached.",
		status,
	});

const createInput = () => ({
	accountId: account.accountId,
	accountConfigId: account.accountConfigId,
	fromAddress: "me@example.com",
	toAddresses: ["them@example.com"],
	subject: "Invoice",
	textBody: "Attached.",
});

const current = (outboxMessageId: string) =>
	store.outboxMessage.get(account.accountConfigId, outboxMessageId);

const all = async () =>
	(await store.outboxMessage.listByAccount(account.accountId)).items;

const isConflict = (error: unknown) => {
	assert.ok(error instanceof ConflictError);
	assert.equal(error.statusCode, 409);
	return true;
};

describe("an enqueue that fails", () => {
	it("settles the new row of createAndSend at failed, saying why, and still reports the failure", async () => {
		enqueueFails = new Error("SQS unavailable");

		await assert.rejects(
			queue().createAndSend(createInput()),
			/SQS unavailable/,
		);

		const [row] = await all();
		assert.equal(row.status, OutboxMessageStatus.failed);
		assert.match(
			String(row.lastError),
			/could not be handed to the outgoing queue/,
		);
	});

	it("takes a sent draft to failed, never back to draft", async () => {
		const draft = await message(OutboxMessageStatus.draft);
		enqueueFails = new Error("SQS unavailable");

		await assert.rejects(
			queue().send(account.accountConfigId, draft.outboxMessageId),
		);

		assert.equal(
			(await current(draft.outboxMessageId)).status,
			OutboxMessageStatus.failed,
		);
	});

	it("returns a blocked row to blocked", async () => {
		const blocked = await message(OutboxMessageStatus.blocked);
		enqueueFails = new Error("SQS unavailable");

		await assert.rejects(
			queue().send(account.accountConfigId, blocked.outboxMessageId),
		);

		assert.equal(
			(await current(blocked.outboxMessageId)).status,
			OutboxMessageStatus.blocked,
		);
	});

	it("leaves a row the worker already took alone", async () => {
		const draft = await message(OutboxMessageStatus.draft);
		enqueueFails = new Error("SQS timed out after the event landed");
		whileEnqueueing = () =>
			store.outboxMessage.updateStatus(
				account.accountConfigId,
				draft.outboxMessageId,
				OutboxMessageStatus.sending,
			);

		await assert.rejects(
			queue().send(account.accountConfigId, draft.outboxMessageId),
		);

		assert.equal(
			(await current(draft.outboxMessageId)).status,
			OutboxMessageStatus.sending,
		);
	});

	it("keeps the row queued when the enqueue succeeds", async () => {
		await queue().createAndSend(createInput());

		const [row] = await all();
		assert.equal(row.status, OutboxMessageStatus.queued);
		assert.equal(enqueued.length, 1);
	});
});

describe("a row the worker settled", () => {
	it("is sendable again from failed, and discardable", async () => {
		const failed = await message(OutboxMessageStatus.failed);

		await queue().send(account.accountConfigId, failed.outboxMessageId);
		assert.equal(
			(await current(failed.outboxMessageId)).status,
			OutboxMessageStatus.queued,
		);

		const other = await message(OutboxMessageStatus.failed);
		await queue().deleteDraft(account.accountConfigId, other.outboxMessageId);
		await assert.rejects(current(other.outboxMessageId));
	});

	it("is discardable but never sendable from unfiled", async () => {
		const unfiled = await message(OutboxMessageStatus.unfiled);

		await assert.rejects(
			queue().send(account.accountConfigId, unfiled.outboxMessageId),
			/cannot be sent again/,
		);
		assert.deepEqual(enqueued, []);

		await queue().deleteDraft(account.accountConfigId, unfiled.outboxMessageId);
		await assert.rejects(current(unfiled.outboxMessageId));
	});
});

describe("correcting a message that failed to send", () => {
	it("accepts the edit, keeps the content and returns the row to draft", async () => {
		const failed = await message(OutboxMessageStatus.failed);

		const updated = await queue().updateDraft(
			account.accountConfigId,
			failed.outboxMessageId,
			{ toAddresses: ["them@example.com"] },
		);

		assert.equal(updated.status, OutboxMessageStatus.draft);
		assert.deepEqual(updated.toAddresses, ["them@example.com"]);
		assert.equal(updated.subject, "Invoice");
	});

	it("sends the corrected message", async () => {
		const failed = await message(OutboxMessageStatus.failed);

		await queue().updateDraft(account.accountConfigId, failed.outboxMessageId, {
			toAddresses: ["them@example.com"],
		});
		await queue().send(account.accountConfigId, failed.outboxMessageId);

		assert.equal(
			(await current(failed.outboxMessageId)).status,
			OutboxMessageStatus.queued,
		);
		assert.equal(enqueued.length, 1);
	});

	it("accepts the edit on a blocked row too", async () => {
		const blocked = await message(OutboxMessageStatus.blocked);

		const updated = await queue().updateDraft(
			account.accountConfigId,
			blocked.outboxMessageId,
			{ subject: "Invoice, corrected" },
		);

		assert.equal(updated.status, OutboxMessageStatus.draft);
	});
});

describe("a message that moves while the request is deciding", () => {
	it("refuses the edit rather than pulling a queued row back to draft", async () => {
		const failed = await message(OutboxMessageStatus.failed);
		beforeNext(store.outboxMessage, "updateIfStatus", () =>
			store.outboxMessage.updateStatus(
				account.accountConfigId,
				failed.outboxMessageId,
				OutboxMessageStatus.queued,
			),
		);

		await assert.rejects(
			queue().updateDraft(account.accountConfigId, failed.outboxMessageId, {
				toAddresses: ["them@example.com"],
			}),
			isConflict,
		);

		assert.equal(
			(await current(failed.outboxMessageId)).status,
			OutboxMessageStatus.queued,
		);
	});

	it("refuses the second of two sends racing the same row", async () => {
		const draft = await message(OutboxMessageStatus.draft);
		beforeNext(store.outboxMessage, "updateIfStatus", () =>
			store.outboxMessage.updateStatus(
				account.accountConfigId,
				draft.outboxMessageId,
				OutboxMessageStatus.sending,
			),
		);

		await assert.rejects(
			queue().send(account.accountConfigId, draft.outboxMessageId),
			isConflict,
		);
		assert.deepEqual(enqueued, []);
	});
});

describe("a message that is not the user's to edit", () => {
	for (const status of [
		OutboxMessageStatus.queued,
		OutboxMessageStatus.sending,
		OutboxMessageStatus.sent,
		OutboxMessageStatus.unfiled,
	]) {
		it(`refuses the edit of a ${status} row`, async () => {
			const row = await message(status);

			await assert.rejects(
				queue().updateDraft(account.accountConfigId, row.outboxMessageId, {
					toAddresses: ["them@example.com"],
				}),
				isConflict,
			);

			assert.deepEqual((await current(row.outboxMessageId)).toAddresses, [
				"typo@exmaple.com",
			]);
		});
	}
});
