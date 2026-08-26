/**
 * The two ways an outbox row used to become unusable without ever leaving.
 *
 * `createAndSend` wrote the row at `queued` and then enqueued. A throw from the
 * enqueue left it there, and `queued` is accepted by neither `send` nor
 * `deleteDraft` — the message could be neither sent nor discarded (#936).
 *
 * A send that failed settled at `failed`, and `updateDraft` refused anything
 * but `draft`. Retry re-queued the same envelope and Edit took a 409 on the
 * flush that precedes the send, so a message refused for a bad address had no
 * way back to sent short of retyping it (#933).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAccountRepository,
	IOutboxMessageRepository,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import { OutboxMessageStatus } from "@remit/domain-enums";
import type { OutboxAttachmentService } from "./outbox-attachment.js";
import { OutboxQueueService } from "./outbox-queue.js";

const ACCOUNT_CONFIG_ID = "cfg-1";
const ACCOUNT_ID = "acc-1";
const OUTBOX_MESSAGE_ID = "ob-1";

const row = (overrides: Partial<OutboxMessageItem>): OutboxMessageItem =>
	({
		outboxMessageId: OUTBOX_MESSAGE_ID,
		accountId: ACCOUNT_ID,
		accountConfigId: ACCOUNT_CONFIG_ID,
		fromAddress: "me@example.com",
		toAddresses: ["typo@exmaple.com"],
		ccAddresses: [],
		bccAddresses: [],
		references: [],
		messageIdValue: "<m1@example.com>",
		subject: "Invoice",
		textBody: "Attached.",
		status: OutboxMessageStatus.draft,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as OutboxMessageItem;

interface Harness {
	service: OutboxQueueService;
	enqueued: string[];
	createdStatuses: string[];
	statusWrites: string[];
	updates: UpdateOutboxMessageInput[];
}

const createHarness = (
	stored: OutboxMessageItem,
	options: { enqueueFails?: Error } = {},
): Harness => {
	const harness: Harness = {
		service: undefined as unknown as OutboxQueueService,
		enqueued: [],
		createdStatuses: [],
		statusWrites: [],
		updates: [],
	};

	let current = stored;

	const outboxMessageService = {
		get: async () => current,
		create: async (input: Record<string, unknown>) => {
			current = row(input as Partial<OutboxMessageItem>);
			harness.createdStatuses.push(current.status);
			return current;
		},
		update: async (
			_configId: string,
			_id: string,
			input: UpdateOutboxMessageInput,
		) => {
			harness.updates.push(input);
			current = row({ ...current, ...input });
			return current;
		},
		updateStatus: async (
			_configId: string,
			_id: string,
			status: OutboxMessageItem["status"],
		) => {
			harness.statusWrites.push(status);
			current = row({ ...current, status });
			return current;
		},
	} as unknown as IOutboxMessageRepository;

	harness.service = new OutboxQueueService({
		outboxMessageService,
		outboxAttachmentService: {} as unknown as OutboxAttachmentService,
		accountService: {} as unknown as IAccountRepository,
		sqsSmtpQueueUrl: "http://localhost/queue",
		sqsClient: {
			send: async (command: { input: { MessageBody: string } }) => {
				if (options.enqueueFails) throw options.enqueueFails;
				harness.enqueued.push(command.input.MessageBody);
				return {};
			},
		} as never,
	});

	return harness;
};

const createInput = {
	accountId: ACCOUNT_ID,
	accountConfigId: ACCOUNT_CONFIG_ID,
	fromAddress: "me@example.com",
	toAddresses: ["them@example.com"],
	subject: "Invoice",
	textBody: "Attached.",
};

describe("createAndSend when the enqueue throws", () => {
	it("leaves no row at `queued` — the status neither button accepts", async () => {
		const harness = createHarness(row({}), {
			enqueueFails: new Error("SQS unavailable"),
		});

		await assert.rejects(
			() => harness.service.createAndSend(createInput),
			/SQS unavailable/,
			"the caller still hears the failure",
		);

		assert.deepEqual(harness.createdStatuses, [OutboxMessageStatus.queued]);
		assert.deepEqual(
			harness.statusWrites,
			[OutboxMessageStatus.draft],
			"the new row settled at draft, keeping the composed text sendable",
		);
	});

	it("keeps the row at `queued` when the enqueue succeeds", async () => {
		const harness = createHarness(row({}));

		await harness.service.createAndSend(createInput);

		assert.equal(harness.enqueued.length, 1);
		assert.deepEqual(harness.statusWrites, [], "nothing walked the row back");
	});
});

describe("correcting a message that failed to send", () => {
	it("accepts the edit and returns the row to `draft`", async () => {
		const harness = createHarness(row({ status: OutboxMessageStatus.failed }));

		const updated = await harness.service.updateDraft(
			ACCOUNT_CONFIG_ID,
			OUTBOX_MESSAGE_ID,
			{ toAddresses: ["them@example.com"] },
		);

		assert.deepEqual(harness.updates, [
			{
				status: OutboxMessageStatus.draft,
				toAddresses: ["them@example.com"],
			},
		]);
		assert.equal(updated.status, OutboxMessageStatus.draft);
		assert.equal(updated.subject, "Invoice", "its content came with it");
	});

	it("sends the corrected message", async () => {
		const harness = createHarness(row({ status: OutboxMessageStatus.failed }));

		await harness.service.updateDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID, {
			toAddresses: ["them@example.com"],
		});
		await harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID);

		assert.deepEqual(harness.statusWrites, [OutboxMessageStatus.queued]);
		assert.equal(harness.enqueued.length, 1);
	});

	it("accepts the edit on a `blocked` row too — Send already does", async () => {
		const harness = createHarness(row({ status: OutboxMessageStatus.blocked }));

		await harness.service.updateDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID, {
			subject: "Invoice, corrected",
		});

		assert.equal(harness.updates[0].status, OutboxMessageStatus.draft);
	});

	it("writes no status on a row that is already a draft", async () => {
		const harness = createHarness(row({}));

		await harness.service.updateDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID, {
			subject: "Invoice, corrected",
		});

		assert.deepEqual(harness.updates, [{ subject: "Invoice, corrected" }]);
	});
});

describe("a message that is not the user's to edit", () => {
	for (const status of [
		OutboxMessageStatus.queued,
		OutboxMessageStatus.sending,
		OutboxMessageStatus.sent,
		OutboxMessageStatus.unfiled,
	]) {
		it(`refuses the edit of a \`${status}\` row`, async () => {
			const harness = createHarness(row({ status }));

			await assert.rejects(
				() =>
					harness.service.updateDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID, {
						toAddresses: ["them@example.com"],
					}),
				(error: unknown) => {
					assert.ok(error instanceof ConflictError);
					assert.equal(error.statusCode, 409);
					return true;
				},
			);

			assert.deepEqual(harness.updates, []);
		});
	}
});
