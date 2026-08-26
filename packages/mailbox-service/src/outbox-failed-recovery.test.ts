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
 *
 * Where a stranded row settles is the load-bearing part. Not `draft`: a throw
 * from `SendMessage` says the response was lost, not that the broker refused
 * the event, and `draft` is inside the SMTP worker's send fence — a row put
 * there is sendable both by the event that landed anyway and by the user
 * pressing Send. `failed` is outside that fence and, since #933, is a row the
 * user can still edit and send.
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

interface ConditionalWrite {
	expected: OutboxMessageItem["status"];
	input: UpdateOutboxMessageInput;
	applied: boolean;
}

interface Harness {
	service: OutboxQueueService;
	enqueued: string[];
	createdStatuses: string[];
	writes: ConditionalWrite[];
	/** What the row holds now, after every write this harness applied. */
	status: () => OutboxMessageItem["status"];
}

interface HarnessOptions {
	enqueueFails?: Error;
	settleFails?: Error;
	/** Moves the row the instant the service reads it, as a racing writer would. */
	movesOnRead?: OutboxMessageItem["status"];
}

const createHarness = (
	stored: OutboxMessageItem,
	options: HarnessOptions = {},
): Harness => {
	let current = stored;

	const harness: Harness = {
		service: undefined as unknown as OutboxQueueService,
		enqueued: [],
		createdStatuses: [],
		writes: [],
		status: () => current.status,
	};

	const outboxMessageService = {
		get: async () => {
			const seen = current;
			if (options.movesOnRead) {
				current = row({ ...current, status: options.movesOnRead });
			}
			return seen;
		},
		create: async (input: Record<string, unknown>) => {
			current = row(input as Partial<OutboxMessageItem>);
			harness.createdStatuses.push(current.status);
			return current;
		},
		updateIfStatus: async (
			_configId: string,
			_id: string,
			expected: OutboxMessageItem["status"],
			input: UpdateOutboxMessageInput,
		) => {
			if (options.settleFails && input.status === OutboxMessageStatus.failed) {
				throw options.settleFails;
			}
			const applied = current.status === expected;
			harness.writes.push({ expected, input, applied });
			if (!applied) return null;
			current = row({ ...current, ...input });
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

const applied = (harness: Harness): UpdateOutboxMessageInput[] =>
	harness.writes.filter((write) => write.applied).map((write) => write.input);

describe("an enqueue that reports a failure", () => {
	it("settles the new row of createAndSend at `failed`, never at `queued`", async () => {
		const harness = createHarness(row({}), {
			enqueueFails: new Error("SQS unavailable"),
		});

		await assert.rejects(
			() => harness.service.createAndSend(createInput),
			/SQS unavailable/,
			"the caller still hears the failure",
		);

		assert.deepEqual(harness.createdStatuses, [OutboxMessageStatus.queued]);
		assert.equal(harness.status(), OutboxMessageStatus.failed);
	});

	it("settles at `failed` rather than `draft` — the event may have landed", async () => {
		// `draft` is inside the worker's send fence, so a row put back there is
		// sent by the landed event and sendable again by hand: two copies of one
		// message. This is the assertion that keeps it out.
		const harness = createHarness(row({}), {
			enqueueFails: new Error("SQS unavailable"),
		});

		await assert.rejects(() => harness.service.createAndSend(createInput));

		assert.notEqual(harness.status(), OutboxMessageStatus.draft);
		assert.match(
			String(applied(harness).at(-1)?.lastError),
			/could not be handed to the outgoing queue/,
			"and it says why, where the Outbox shows it",
		);
	});

	it("takes a draft that was sent to `failed`, not back to `draft`", async () => {
		const harness = createHarness(row({}), {
			enqueueFails: new Error("SQS unavailable"),
		});

		await assert.rejects(() =>
			harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID),
		);

		assert.equal(harness.status(), OutboxMessageStatus.failed);
	});

	it("returns a `blocked` row to `blocked` — outside the fence, and the reason stands", async () => {
		const harness = createHarness(
			row({ status: OutboxMessageStatus.blocked }),
			{
				enqueueFails: new Error("SQS unavailable"),
			},
		);

		await assert.rejects(() =>
			harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID),
		);

		assert.equal(harness.status(), OutboxMessageStatus.blocked);
	});

	it("only settles a row still at `queued` — the worker may already hold it", async () => {
		const harness = createHarness(row({}), {
			enqueueFails: new Error("SQS unavailable"),
		});

		await assert.rejects(() => harness.service.createAndSend(createInput));

		const settle = harness.writes.at(-1);
		assert.equal(settle?.expected, OutboxMessageStatus.queued);
	});

	it("still reports the enqueue failure when the settle write also fails", async () => {
		// The settle is the repair, not the failure. Replacing the enqueue error
		// with the repair's would name the wrong cause and hide the row's state.
		const harness = createHarness(row({}), {
			enqueueFails: new Error("SQS unavailable"),
			settleFails: new Error("database unreachable"),
		});

		await assert.rejects(
			() => harness.service.createAndSend(createInput),
			/SQS unavailable/,
		);
	});

	it("keeps the row at `queued` when the enqueue succeeds", async () => {
		const harness = createHarness(row({}));

		await harness.service.createAndSend(createInput);

		assert.equal(harness.enqueued.length, 1);
		assert.deepEqual(harness.writes, [], "nothing walked the row back");
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

		assert.deepEqual(applied(harness), [
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

		assert.equal(harness.status(), OutboxMessageStatus.queued);
		assert.equal(harness.enqueued.length, 1);
	});

	it("accepts the edit on a `blocked` row too — Send already does", async () => {
		const harness = createHarness(row({ status: OutboxMessageStatus.blocked }));

		await harness.service.updateDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID, {
			subject: "Invoice, corrected",
		});

		assert.equal(applied(harness).at(0)?.status, OutboxMessageStatus.draft);
	});

	it("writes no status on a row that is already a draft", async () => {
		const harness = createHarness(row({}));

		await harness.service.updateDraft(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID, {
			subject: "Invoice, corrected",
		});

		assert.deepEqual(applied(harness), [{ subject: "Invoice, corrected" }]);
	});
});

describe("a message that moves while the request is deciding", () => {
	it("refuses the edit rather than pulling a queued row back to `draft`", async () => {
		// The send this loses to has an event on the wire, and `draft` is inside
		// the fence that event has to pass.
		const harness = createHarness(row({ status: OutboxMessageStatus.failed }), {
			movesOnRead: OutboxMessageStatus.queued,
		});

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

		assert.equal(harness.status(), OutboxMessageStatus.queued);
	});

	it("refuses the second of two sends racing the same row", async () => {
		const harness = createHarness(row({}), {
			movesOnRead: OutboxMessageStatus.sending,
		});

		await assert.rejects(
			() => harness.service.send(ACCOUNT_CONFIG_ID, OUTBOX_MESSAGE_ID),
			(error: unknown) => {
				assert.ok(error instanceof ConflictError);
				return true;
			},
		);

		assert.deepEqual(harness.enqueued, [], "nothing reached the SMTP queue");
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

			assert.deepEqual(harness.writes, []);
		});
	}
});
