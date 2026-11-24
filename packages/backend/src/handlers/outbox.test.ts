/**
 * Issue #604: composing a reply, sending it, and then letting one more autosave
 * land 500'd the browser with "Internal server error" two seconds after a send
 * that had actually succeeded.
 *
 * A PATCH against an entry that is no longer a draft is a foreseeable race, not
 * a fault: the draft editor debounces its writes, so the last one can be in
 * flight while the send flips the status. The designed answer is 409 — the
 * entry is immutable now, and saying so truthfully is what lets a client stop.
 *
 * Driven through the real handlers, the real OutboxQueueService and the real
 * error funnel, so what is asserted is the status code the browser receives.
 * The queue is stood in for; messages and attachments use SQLite.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { IAccountRepository } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	failingQueue,
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { OutboxMessageStatus } from "@remit/domain-enums";
import {
	OutboxAttachmentService,
	OutboxQueueService,
} from "@remit/mailbox-service";
import {
	openStore,
	type Store,
} from "@remit/mailbox-service/test-helpers/test-store";
import {
	createMockStorageService,
	type StorageService,
} from "@remit/storage-service";
import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";

import type {
	HandlerContext,
	OperationHandler,
	OperationIds,
} from "../types.js";
import { OutboxDetailOperations, OutboxOperations } from "./outbox.js";

let client: RemitClient;

const CONTENT_DOMAIN = "https://content.test";

const SUB = "cognito-sub-604";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const ACCOUNT_ID = "acc-604";
const ACCOUNT_EMAIL = "sender@example.com";

/** A queue that refuses every send until `accept()` is called. */
const refusingQueue = (): { client: RecordingQueue; accept: () => void } => {
	const client = failingQueue(new Error("SQS unavailable"));
	return {
		client,
		accept: () => client.answer(async () => ({})),
	};
};

let accountSyncedServices: string[] = ["Mail"];

const accountRepository = {
	get: async () => ({
		accountId: ACCOUNT_ID,
		accountConfigId: ACCOUNT_CONFIG_ID,
		email: ACCOUNT_EMAIL,
		syncedServices: accountSyncedServices,
	}),
} as unknown as IAccountRepository;

let installedStorage: StorageService | null = null;
let attachmentStore: Store;
const installClient = async (
	queue: RecordingQueue = recordingQueue(),
): Promise<void> => {
	const storage = createMockStorageService();
	attachmentStore = await openStore();
	const { outboxMessage } = attachmentStore;
	const outboxAttachmentService = new OutboxAttachmentService({
		outboxMessageService: outboxMessage,
		outboxAttachmentService: attachmentStore.outboxAttachment,
		storage,
	});
	installedStorage = storage;
	client = {
		outboxMessage,
		storage,
		account: accountRepository,
		outboxAttachment: outboxAttachmentService,
		outboxQueue: new OutboxQueueService({
			outboxMessageService: outboxMessage,
			outboxAttachmentService,
			accountService: accountRepository,
			queue,
		}),
	} as unknown as RemitClient;
};

const caller = (): HandlerContext<QueueName> => ({
	client,
	config: testApiConfig({ contentDeliveryDomain: CONTENT_DOMAIN }),
	identity: {
		kind: "user",
		accountConfigId: ACCOUNT_CONFIG_ID,
		sub: SUB,
		email: "caller@example.com",
	},
});

const requestContext = (
	request: {
		params?: Record<string, string>;
		requestBody?: unknown;
	},
	requestBody?: unknown,
): Context =>
	({
		request: requestBody === undefined ? request : { ...request, requestBody },
	}) as unknown as Context;

type OutboxHandler = OperationHandler<OperationIds, "smtp">;

const createDraft: OutboxHandler =
	OutboxOperations.OutboxOperations_createOutboxMessage;
const sendMessage: OutboxHandler =
	OutboxDetailOperations.OutboxDetailOperations_sendOutboxMessage;
const updateDraft: OutboxHandler =
	OutboxDetailOperations.OutboxDetailOperations_updateOutboxMessage;
const deleteDraft: OutboxHandler =
	OutboxDetailOperations.OutboxDetailOperations_deleteOutboxMessage;
const getMessage: OutboxHandler =
	OutboxDetailOperations.OutboxDetailOperations_getOutboxMessage;

type Outcome =
	| { readonly ok: true; readonly body: Record<string, unknown> }
	| { readonly ok: false; readonly error: unknown };

/** The response the browser would receive, error funnel included. */
const respond = async (
	run: () => Promise<Record<string, unknown>>,
): Promise<APIGatewayProxyResult> => {
	const outcome: Outcome = await run().then(
		(body) => ({ ok: true, body }) as const,
		(error: unknown) => ({ ok: false, error }) as const,
	);
	if (!outcome.ok) return handleError(outcome.error);
	return formatResponse(outcome.body);
};

const sentOutboxMessageId = async (): Promise<string> => {
	const draft = await createDraft(
		requestContext(
			{},
			{
				accountId: ACCOUNT_ID,
				toAddresses: ["recipient@example.com"],
				subject: "Re: the thing",
				textBody: "on it",
			},
		),
		caller(),
	);
	const outboxMessageId = draft.outboxMessageId;
	assert.equal(typeof outboxMessageId, "string");

	const sent = await sendMessage(
		requestContext({ params: { outboxMessageId: String(outboxMessageId) } }),
		caller(),
	);
	assert.notEqual(sent.status, "draft");

	return String(outboxMessageId);
};

afterEach(async () => {
	await attachmentStore?.close();
	accountSyncedServices = ["Mail"];
});

describe("an outbox entry that has left draft (#604)", () => {
	it("answers a late autosave PATCH with 409, never a 500", async () => {
		await installClient();
		const outboxMessageId = await sentOutboxMessageId();

		const response = await respond(() =>
			updateDraft(
				requestContext({
					params: { outboxMessageId },
					requestBody: { subject: "Re: the thing", textBody: "on it!" },
				}),
				caller(),
			),
		);

		assert.equal(response.statusCode, 409);
		const body = JSON.parse(response.body) as { message?: string };
		assert.match(String(body.message), /can no longer be edited/);
	});

	it("refuses a second send with 409, never a 500", async () => {
		await installClient();
		const outboxMessageId = await sentOutboxMessageId();

		const response = await respond(() =>
			sendMessage(requestContext({ params: { outboxMessageId } }), caller()),
		);

		assert.equal(response.statusCode, 409);
	});

	it("refuses a discard with 409, never a 500", async () => {
		await installClient();
		const outboxMessageId = await sentOutboxMessageId();

		const response = await respond(() =>
			deleteDraft(requestContext({ params: { outboxMessageId } }), caller()),
		);

		assert.equal(response.statusCode, 409);
	});

	it("still discards a message that was sent but never filed", async () => {
		await installClient();
		const outboxMessageId = await sentOutboxMessageId();
		await client.outboxMessage.update(ACCOUNT_CONFIG_ID, outboxMessageId, {
			status: OutboxMessageStatus.unfiled,
		});

		const response = await respond(() =>
			deleteDraft(requestContext({ params: { outboxMessageId } }), caller()),
		);

		assert.equal(response.statusCode, 204);
	});

	it("still accepts an autosave PATCH while the entry is a draft", async () => {
		await installClient();
		const draft = await createDraft(
			requestContext(
				{},
				{
					accountId: ACCOUNT_ID,
					toAddresses: ["recipient@example.com"],
				},
			),
			caller(),
		);

		const response = await respond(() =>
			updateDraft(
				requestContext({
					params: { outboxMessageId: String(draft.outboxMessageId) },
					requestBody: { subject: "still editing" },
				}),
				caller(),
			),
		);

		assert.equal(response.statusCode, 200);
		const body = JSON.parse(response.body) as { subject?: string };
		assert.equal(body.subject, "still editing");
	});
});

describe("a send whose enqueue fails (#845.8)", () => {
	const draftAgainstQueue = async (
		queue: RecordingQueue,
	): Promise<{ outboxMessageId: string; response: APIGatewayProxyResult }> => {
		await installClient(queue);
		const draft = await createDraft(
			requestContext(
				{},
				{
					accountId: ACCOUNT_ID,
					toAddresses: ["recipient@example.com"],
					subject: "the one that got stuck",
					textBody: "sending",
				},
			),
			caller(),
		);
		const outboxMessageId = String(draft.outboxMessageId);
		const response = await respond(() =>
			sendMessage(requestContext({ params: { outboxMessageId } }), caller()),
		);
		return { outboxMessageId, response };
	};

	const statusOf = async (outboxMessageId: string): Promise<unknown> => {
		const response = await respond(() =>
			getMessage(requestContext({ params: { outboxMessageId } }), caller()),
		);
		assert.equal(response.statusCode, 200);
		return (JSON.parse(response.body) as { status?: string }).status;
	};

	it("answers 500, never a success the send never had", async () => {
		const { response } = await draftAgainstQueue(refusingQueue().client);

		assert.equal(response.statusCode, 500);
	});

	it("settles the row at failed, not stranded at queued and not back at draft", async () => {
		const { outboxMessageId } = await draftAgainstQueue(refusingQueue().client);

		// `queued` is the dead end this suite exists for. `draft` is the other
		// wrong answer: it is inside the SMTP worker's send fence, and an error
		// from SQS does not prove the event was refused — one that landed anyway
		// would send a row the user can still send by hand. `failed` is outside
		// the fence and, since #933, still editable and sendable.
		assert.equal(await statusOf(outboxMessageId), OutboxMessageStatus.failed);
	});

	it("still lets the user discard what could not be queued", async () => {
		const { outboxMessageId } = await draftAgainstQueue(refusingQueue().client);

		const response = await respond(() =>
			deleteDraft(requestContext({ params: { outboxMessageId } }), caller()),
		);

		assert.equal(response.statusCode, 204);
	});

	it("sends once the queue comes back", async () => {
		const queue = refusingQueue();
		const { outboxMessageId } = await draftAgainstQueue(queue.client);
		queue.accept();

		const response = await respond(() =>
			sendMessage(requestContext({ params: { outboxMessageId } }), caller()),
		);

		assert.equal(response.statusCode, 200);
		assert.equal(
			(JSON.parse(response.body) as { status?: string }).status,
			OutboxMessageStatus.queued,
		);
	});
});

describe("discarding a draft that carries files (#679)", () => {
	it("takes the stored bytes with it, leaving nothing behind", async () => {
		await installClient();
		const storage = installedStorage;
		assert.ok(storage);

		const draft = await createDraft(
			requestContext(
				{},
				{
					accountId: ACCOUNT_ID,
					toAddresses: ["recipient@example.com"],
				},
			),
			caller(),
		);
		const outboxMessageId = String(draft.outboxMessageId);

		const minted = await client.outboxAttachment.mint({
			accountConfigId: ACCOUNT_CONFIG_ID,
			outboxMessageId,
			filename: "receipt.pdf",
			contentType: "application/pdf",
			sizeBytes: 16,
		});
		assert.equal(minted.outcome, "Minted");
		// A mint reserves in the ledger; nothing is uploaded yet, so what a discard
		// has to take with it is the reservation, not an object.
		// A mint writes a row; nothing is uploaded yet, so what a discard has to
		// take with it is the row, not an object.
		assert.equal(
			(
				await attachmentStore.outboxAttachment.listByOutboxMessage(
					ACCOUNT_CONFIG_ID,
					outboxMessageId,
				)
			).length,
			1,
		);

		const response = await respond(() =>
			deleteDraft(requestContext({ params: { outboxMessageId } }), caller()),
		);

		assert.equal(response.statusCode, 204);
		// Nothing else references these objects, so a row that goes without them
		// leaves bytes no sweep collects.
		assert.deepEqual(
			await storage.listOutboxAttachments(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				outboxMessageId,
			),
			[],
		);
		assert.equal(
			(
				await attachmentStore.outboxAttachment.listByOutboxMessage(
					ACCOUNT_CONFIG_ID,
					outboxMessageId,
				)
			).length,
			0,
		);
	});
});

describe("attachmentIds on a draft update (#679)", () => {
	const seed = async (): Promise<{
		outboxMessageId: string;
		ids: string[];
	}> => {
		const draft = await createDraft(
			requestContext(
				{},
				{
					accountId: ACCOUNT_ID,
					toAddresses: ["recipient@example.com"],
				},
			),
			caller(),
		);
		const outboxMessageId = String(draft.outboxMessageId);
		const ids: string[] = [];
		for (const filename of ["one.txt", "two.txt"]) {
			const minted = await client.outboxAttachment.mint({
				accountConfigId: ACCOUNT_CONFIG_ID,
				outboxMessageId,
				filename,
				contentType: "text/plain",
				sizeBytes: 8,
			});
			assert.equal(minted.outcome, "Minted");
			if (minted.outcome !== "Minted") throw new Error("unreachable");
			ids.push(minted.reservation.outboxAttachmentId);
		}
		return { outboxMessageId, ids };
	};

	const patch = (outboxMessageId: string, requestBody: unknown) =>
		respond(() =>
			updateDraft(
				requestContext({ params: { outboxMessageId }, requestBody }),
				caller(),
			),
		);

	it("absent leaves the files alone — a subject-only save keeps them", async () => {
		await installClient();
		const { outboxMessageId } = await seed();

		const response = await patch(outboxMessageId, { subject: "still typing" });

		assert.equal(response.statusCode, 200);
		const body = JSON.parse(response.body) as { attachments: unknown[] };
		assert.equal(body.attachments.length, 2);
		assert.equal(
			(
				await attachmentStore.outboxAttachment.listByOutboxMessage(
					ACCOUNT_CONFIG_ID,
					outboxMessageId,
				)
			).length,
			2,
		);
	});

	it("names each file by its content-id and where its bytes are read from", async () => {
		await installClient();
		const { outboxMessageId, ids } = await seed();

		const response = await patch(outboxMessageId, { subject: "still typing" });

		const body = JSON.parse(response.body) as {
			attachments: {
				outboxAttachmentId: string;
				contentId: string;
				contentUrl: string;
			}[];
		};
		const [first] = body.attachments.filter(
			(item) => item.outboxAttachmentId === ids[0],
		);
		assert.equal(first.contentId, `${ids[0]}@remit`);
		assert.ok(
			first.contentUrl.startsWith(
				`${CONTENT_DOMAIN}/content/${(await attachmentStore.outboxAttachment.get(ACCOUNT_CONFIG_ID, ids[0])).storageKey}`,
			),
			first.contentUrl,
		);
	});

	it("present and empty removes every file", async () => {
		await installClient();
		const { outboxMessageId } = await seed();

		const response = await patch(outboxMessageId, { attachmentIds: [] });

		assert.equal(response.statusCode, 200);
		assert.deepEqual(
			(JSON.parse(response.body) as { attachments: unknown[] }).attachments,
			[],
		);
		assert.equal(
			(
				await attachmentStore.outboxAttachment.listByOutboxMessage(
					ACCOUNT_CONFIG_ID,
					outboxMessageId,
				)
			).length,
			0,
		);
	});

	it("present with ids keeps those and removes the rest, bytes included", async () => {
		await installClient();
		const { outboxMessageId, ids } = await seed();
		const storage = installedStorage;
		assert.ok(storage);
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId,
			outboxAttachmentId: ids[1],
			content: Buffer.from("dropped"),
		});

		const response = await patch(outboxMessageId, {
			attachmentIds: [ids[0]],
		});

		assert.equal(response.statusCode, 200);
		const body = JSON.parse(response.body) as {
			attachments: { outboxAttachmentId: string }[];
		};
		assert.deepEqual(
			body.attachments.map((item) => item.outboxAttachmentId),
			[ids[0]],
		);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				outboxMessageId,
				ids[1],
			),
			null,
		);
	});

	it("an unknown id is a no-op, not a reason to drop the known ones", async () => {
		await installClient();
		const { outboxMessageId, ids } = await seed();

		const response = await patch(outboxMessageId, {
			attachmentIds: [...ids, "never-existed"],
		});

		assert.equal(response.statusCode, 200);
		assert.equal(
			(
				await attachmentStore.outboxAttachment.listByOutboxMessage(
					ACCOUNT_CONFIG_ID,
					outboxMessageId,
				)
			).length,
			2,
		);
	});
});

describe("sending from an account with mail off (#1181)", () => {
	const assertRefusal = (response: APIGatewayProxyResult): void => {
		assert.equal(response.statusCode, 400);
		const body = JSON.parse(response.body) as {
			code?: string;
			message?: string;
			details?: Record<string, string>;
		};
		assert.equal(body.code, "mail_sync_off");
		assert.match(String(body.message), /Turn Mail back on .* in Settings/);
		assert.deepEqual(body.details, { accountId: ACCOUNT_ID });
	};

	it("answers a send of a saved draft with a 400 naming the fix", async () => {
		await installClient();
		const draft = await createDraft(
			requestContext(
				{},
				{
					accountId: ACCOUNT_ID,
					toAddresses: ["recipient@example.com"],
					subject: "hello",
				},
			),
			caller(),
		);
		accountSyncedServices = ["Calendar"];

		const response = await respond(() =>
			sendMessage(
				requestContext({
					params: { outboxMessageId: String(draft.outboxMessageId) },
				}),
				caller(),
			),
		);

		assertRefusal(response);
		const kept = await getMessage(
			requestContext({
				params: { outboxMessageId: String(draft.outboxMessageId) },
			}),
			caller(),
		);
		assert.equal(kept.status, "draft");
	});

	it("answers a send-immediately create with the same 400", async () => {
		await installClient();
		accountSyncedServices = ["Calendar"];

		const response = await respond(() =>
			createDraft(
				requestContext(
					{},
					{
						accountId: ACCOUNT_ID,
						toAddresses: ["recipient@example.com"],
						subject: "hello",
						sendImmediately: true,
					},
				),
				caller(),
			),
		);

		assertRefusal(response);
	});
});
