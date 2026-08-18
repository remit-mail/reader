/**
 * A message with nobody to send to must be refused where the person who pressed
 * Send can see the refusal.
 *
 * `@minItems(1)` on `CreateOutboxMessageInput.toAddresses` was the only check
 * anywhere on the path, and neither route into the queue passes it: `send`
 * takes a stored draft, which the update endpoint will happily strip every
 * address off, and `createAndSend` reaches nodemailer with whatever it was
 * handed. Nodemailer refuses an empty envelope inside the SMTP worker, so the
 * message dies in the DLQ and the composer reports a send that went nowhere.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAccountRepository,
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import { OutboxMessageStatus } from "@remit/domain-enums";
import type { OutboxAttachmentService } from "./outbox-attachment.js";
import { OutboxQueueService } from "./outbox-queue.js";

const ACCOUNT_CONFIG_ID = "cfg-1";
const ACCOUNT_ID = "acc-1";
const OUTBOX_MESSAGE_ID = "ob-1";

const draft = (overrides: Partial<OutboxMessageItem>): OutboxMessageItem =>
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
		status: OutboxMessageStatus.draft,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as OutboxMessageItem;

interface Harness {
	service: OutboxQueueService;
	enqueued: string[];
	created: number;
	statusWrites: string[];
}

const createHarness = (stored: OutboxMessageItem): Harness => {
	const harness: Harness = {
		service: undefined as unknown as OutboxQueueService,
		enqueued: [],
		created: 0,
		statusWrites: [],
	};

	const outboxMessageService = {
		get: async () => stored,
		create: async (input: Record<string, unknown>) => {
			harness.created += 1;
			return draft(input as Partial<OutboxMessageItem>);
		},
		updateStatus: async (
			_configId: string,
			_id: string,
			status: OutboxMessageItem["status"],
		) => {
			harness.statusWrites.push(status);
			return draft({ status });
		},
	} as unknown as IOutboxMessageRepository;

	harness.service = new OutboxQueueService({
		outboxMessageService,
		outboxAttachmentService: {} as unknown as OutboxAttachmentService,
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

const sendInput = (overrides: Record<string, unknown>) => ({
	accountId: ACCOUNT_ID,
	accountConfigId: ACCOUNT_CONFIG_ID,
	fromAddress: "me@example.com",
	toAddresses: [] as string[],
	...overrides,
});

describe("OutboxQueueService and a message with nowhere to go", () => {
	it("refuses to queue a stored draft that has lost every address", async () => {
		const harness = createHarness(
			draft({ toAddresses: [], ccAddresses: [], bccAddresses: [] }),
		);

		await assert.rejects(
			() => harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID),
			(error: unknown) => {
				assert.ok(error instanceof BadRequestError);
				assert.equal(error.statusCode, 400);
				return true;
			},
		);

		assert.deepEqual(harness.statusWrites, [], "it stayed a draft");
		assert.deepEqual(harness.enqueued, [], "nothing reached the SMTP queue");
	});

	it("queues a draft addressed only in Bcc — that envelope is real", async () => {
		const harness = createHarness(
			draft({ toAddresses: [], bccAddresses: ["them@example.com"] }),
		);

		await harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID);

		assert.deepEqual(harness.statusWrites, [OutboxMessageStatus.queued]);
		assert.equal(harness.enqueued.length, 1);
	});

	it("refuses a send-immediately create with no addresses, before writing a row", async () => {
		const harness = createHarness(draft({}));

		await assert.rejects(
			() => harness.service.createAndSend(sendInput({})),
			(error: unknown) => {
				assert.ok(error instanceof BadRequestError);
				assert.equal(error.statusCode, 400);
				return true;
			},
		);

		assert.equal(harness.created, 0, "no queued row was left behind");
		assert.deepEqual(harness.enqueued, [], "nothing reached the SMTP queue");
	});

	it("still creates and queues a send-immediately message that has a recipient", async () => {
		const harness = createHarness(draft({}));

		await harness.service.createAndSend(
			sendInput({ toAddresses: ["them@example.com"] }),
		);

		assert.equal(harness.created, 1);
		assert.equal(harness.enqueued.length, 1);
	});
});
