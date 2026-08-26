/**
 * A row the SMTP worker settled has to be a row the user can still act on.
 *
 * `sending` is not: `send` takes draft, failed and blocked, and `deleteDraft`
 * those three plus `unfiled`, so a send that never reached the server left a
 * row that 409s on both buttons forever (#951). The worker now settles that
 * row instead of dead-lettering it, and these are the two moves the settled
 * status has to accept for the settle to be worth anything.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAccountRepository,
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { OutboxMessageStatus } from "@remit/domain-enums";
import type { OutboxAttachmentService } from "./outbox-attachment.js";
import { OutboxQueueService } from "./outbox-queue.js";

const ACCOUNT_CONFIG_ID = "cfg-1";
const ACCOUNT_ID = "acc-1";
const OUTBOX_MESSAGE_ID = "ob-1";

const row = (status: OutboxMessageItem["status"]): OutboxMessageItem =>
	({
		outboxMessageId: OUTBOX_MESSAGE_ID,
		accountId: ACCOUNT_ID,
		accountConfigId: ACCOUNT_CONFIG_ID,
		fromAddress: "me@example.com",
		toAddresses: ["them@example.com"],
		ccAddresses: [],
		bccAddresses: [],
		references: [],
		messageIdValue: "<m1@example.com>",
		lastError: "SMTP connection failed: ECONNREFUSED",
		status,
		createdAt: 0,
		updatedAt: 0,
	}) as unknown as OutboxMessageItem;

interface Harness {
	service: OutboxQueueService;
	enqueued: string[];
	statusWrites: string[];
	deleted: string[];
	discarded: string[];
}

const createHarness = (stored: OutboxMessageItem): Harness => {
	const harness: Harness = {
		service: undefined as unknown as OutboxQueueService,
		enqueued: [],
		statusWrites: [],
		deleted: [],
		discarded: [],
	};

	const outboxMessageService = {
		get: async () => stored,
		updateStatus: async (
			_configId: string,
			_id: string,
			status: OutboxMessageItem["status"],
		) => {
			harness.statusWrites.push(status);
			return { ...stored, status };
		},
		updateIfStatus: async (
			_configId: string,
			_id: string,
			_expected: OutboxMessageItem["status"],
			input: { status?: OutboxMessageItem["status"] },
		) => {
			if (input.status) harness.statusWrites.push(input.status);
			return { ...stored, ...input };
		},
		delete: async (_configId: string, id: string) => {
			harness.deleted.push(id);
		},
	} as unknown as IOutboxMessageRepository;

	harness.service = new OutboxQueueService({
		outboxMessageService,
		outboxAttachmentService: {
			discardAll: async (_configId: string, _accountId: string, id: string) => {
				harness.discarded.push(id);
			},
		} as unknown as OutboxAttachmentService,
		accountService: {} as unknown as IAccountRepository,
		sqsSmtpQueueUrl: "http://localhost/queue",
		sqsClient: {
			send: async (command: { input: { MessageBody: string } }) => {
				harness.enqueued.push(command.input.MessageBody);
				return {};
			},
		} as never,
	});

	return harness;
};

describe("a row the worker settled at `failed`", () => {
	it("is sendable again — Retry is the whole point of settling there", async () => {
		const harness = createHarness(row(OutboxMessageStatus.failed));

		await harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID);

		assert.deepEqual(harness.statusWrites, [OutboxMessageStatus.queued]);
		assert.equal(harness.enqueued.length, 1);
	});

	it("is discardable — the other way out of the Outbox", async () => {
		const harness = createHarness(row(OutboxMessageStatus.failed));

		await harness.service.deleteDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID);

		assert.deepEqual(harness.deleted, [OUTBOX_MESSAGE_ID]);
		assert.deepEqual(harness.discarded, [OUTBOX_MESSAGE_ID]);
	});
});

describe("a row the worker settled at `unfiled`", () => {
	it("is discardable but never sendable — the server may already hold it", async () => {
		const harness = createHarness(row(OutboxMessageStatus.unfiled));

		await assert.rejects(
			() => harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID),
			/cannot be sent again/,
		);
		assert.deepEqual(harness.enqueued, [], "nothing reached the SMTP queue");

		await harness.service.deleteDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID);
		assert.deepEqual(harness.deleted, [OUTBOX_MESSAGE_ID]);
	});
});
