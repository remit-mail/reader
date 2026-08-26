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
 * Only the queue and the store are stood in for.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SQSClient } from "@aws-sdk/client-sqs";
import type {
	CreateOutboxAttachmentInput,
	CreateOutboxMessageInput,
	IAccountRepository,
	IOutboxAttachmentRepository,
	IOutboxMessageRepository,
	OutboxAttachmentItem,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/data-ports";
import { APPENDED_UID_NONE } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { OutboxMessageStatus } from "@remit/domain-enums";
import {
	OutboxAttachmentService,
	OutboxQueueService,
} from "@remit/mailbox-service";
import {
	createMockStorageService,
	type StorageService,
} from "@remit/storage-service";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import {
	_resetForTest,
	getClient,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { OutboxDetailOperations, OutboxOperations } from "./outbox.js";

const SUB = "cognito-sub-604";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const ACCOUNT_ID = "acc-604";
const ACCOUNT_EMAIL = "sender@example.com";

const createInMemoryOutboxRepository = (): IOutboxMessageRepository => {
	const rows = new Map<string, OutboxMessageItem>();
	let sequence = 0;

	const mustGet = (outboxMessageId: string): OutboxMessageItem => {
		const row = rows.get(outboxMessageId);
		if (!row) throw new NotFoundError(`No outbox message ${outboxMessageId}`);
		return row;
	};

	const repository = {
		create: async (
			input: CreateOutboxMessageInput,
		): Promise<OutboxMessageItem> => {
			sequence += 1;
			const now = Date.now();
			const row: OutboxMessageItem = {
				...input,
				ccAddresses: input.ccAddresses ?? [],
				bccAddresses: input.bccAddresses ?? [],
				references: input.references ?? [],
				appendedUid: APPENDED_UID_NONE,
				outboxMessageId: `outbox-${sequence}`,
				createdAt: now,
				updatedAt: now,
			};
			rows.set(row.outboxMessageId, row);
			return row;
		},
		get: async (
			_accountConfigId: string,
			outboxMessageId: string | string[],
		) =>
			Array.isArray(outboxMessageId)
				? outboxMessageId.map(mustGet)
				: mustGet(outboxMessageId),
		update: async (
			_accountConfigId: string,
			outboxMessageId: string,
			input: UpdateOutboxMessageInput,
		): Promise<OutboxMessageItem> => {
			const row = {
				...mustGet(outboxMessageId),
				...input,
				updatedAt: Date.now(),
			};
			rows.set(outboxMessageId, row);
			return row;
		},
		updateStatus: async (
			accountConfigId: string,
			outboxMessageId: string,
			status: OutboxMessageItem["status"],
		) => repository.update(accountConfigId, outboxMessageId, { status }),
		updateIfStatus: async (
			accountConfigId: string,
			outboxMessageId: string,
			expected: OutboxMessageItem["status"],
			input: UpdateOutboxMessageInput,
		) => {
			if (mustGet(outboxMessageId).status !== expected) return null;
			return repository.update(accountConfigId, outboxMessageId, input);
		},
		markSent: async (
			accountConfigId: string,
			outboxMessageId: string,
			fields: { sentAt: number; smtpMessageId?: string },
		) =>
			repository.update(accountConfigId, outboxMessageId, {
				...fields,
				status: OutboxMessageStatus.sent,
			}),
		delete: async (_accountConfigId: string, outboxMessageId: string) => {
			rows.delete(outboxMessageId);
		},
		deleteMany: async (
			_accountConfigId: string,
			outboxMessageIds: string[],
		) => {
			for (const id of outboxMessageIds) rows.delete(id);
		},
		listByAccount: async () => ({
			items: [...rows.values()],
			continuationToken: null,
		}),
		listQueued: async () =>
			[...rows.values()].filter(
				(row) => row.status === OutboxMessageStatus.queued,
			),
	} as unknown as IOutboxMessageRepository;

	return repository;
};

const acceptingSqsClient = (): SQSClient =>
	({ send: async () => ({}) }) as unknown as SQSClient;

/** A queue that refuses every send until `accept()` is called. */
const refusingSqsClient = (): { client: SQSClient; accept: () => void } => {
	let accepting = false;
	return {
		client: {
			send: async () => {
				if (!accepting) throw new Error("SQS unavailable");
				return {};
			},
		} as unknown as SQSClient,
		accept: () => {
			accepting = true;
		},
	};
};

const accountRepository = {
	get: async () => ({
		accountId: ACCOUNT_ID,
		accountConfigId: ACCOUNT_CONFIG_ID,
		email: ACCOUNT_EMAIL,
	}),
} as unknown as IAccountRepository;

let installedStorage: StorageService | null = null;
let attachmentRows = new Map<string, OutboxAttachmentItem>();

/** Rows only — this suite asserts what a discard takes, not how bytes move. */
const createAttachmentRepository = (
	rows: Map<string, OutboxAttachmentItem>,
): IOutboxAttachmentRepository =>
	({
		reserve: async (input: CreateOutboxAttachmentInput) => {
			const item = {
				...input,
				state: "Pending",
				createdAt: 0,
				updatedAt: 0,
			} as OutboxAttachmentItem;
			rows.set(item.outboxAttachmentId, item);
			return { outcome: "Reserved", item };
		},
		listByOutboxMessage: async (
			_accountConfigId: string,
			outboxMessageId: string,
		) =>
			[...rows.values()].filter(
				(row) => row.outboxMessageId === outboxMessageId,
			),
		deleteByOutboxMessage: async (
			_accountConfigId: string,
			outboxMessageId: string,
		) => {
			for (const row of [...rows.values()]) {
				if (row.outboxMessageId === outboxMessageId) {
					rows.delete(row.outboxAttachmentId);
				}
			}
		},
		deleteLapsedReservations: async (
			accountConfigId: string,
			outboxMessageId: string,
			nowSeconds: number,
		) => {
			const gone: string[] = [];
			for (const row of [...rows.values()]) {
				if (
					row.accountConfigId === accountConfigId &&
					row.outboxMessageId === outboxMessageId &&
					row.state === "Pending" &&
					row.reservationExpiresAt < nowSeconds
				) {
					rows.delete(row.outboxAttachmentId);
					gone.push(row.outboxAttachmentId);
				}
			}
			return gone;
		},
		deleteMany: async (_accountConfigId: string, ids: string[]) => {
			for (const id of ids) rows.delete(id);
		},
	}) as unknown as IOutboxAttachmentRepository;

const installClient = (sqsClient: SQSClient = acceptingSqsClient()): void => {
	const outboxMessage = createInMemoryOutboxRepository();
	const storage = createMockStorageService();
	attachmentRows = new Map<string, OutboxAttachmentItem>();
	const outboxAttachmentService = new OutboxAttachmentService({
		outboxMessageService: outboxMessage,
		outboxAttachmentService: createAttachmentRepository(attachmentRows),
		storage,
	});
	installedStorage = storage;
	setClient({
		outboxMessage,
		storage,
		account: accountRepository,
		outboxAttachment: outboxAttachmentService,
		outboxQueue: new OutboxQueueService({
			outboxMessageService: outboxMessage,
			outboxAttachmentService,
			accountService: accountRepository,
			sqsSmtpQueueUrl: "http://localhost:9324/queue/outbox-test",
			sqsClient,
		}),
	} as unknown as RemitClient);
};

const authorizedEvent = (body?: unknown): APIGatewayProxyEvent =>
	({
		body: body === undefined ? null : JSON.stringify(body),
		requestContext: { authorizer: { claims: { sub: SUB } } },
	}) as unknown as APIGatewayProxyEvent;

const requestContext = (request: {
	params?: Record<string, string>;
	requestBody?: unknown;
}): Context => ({ request }) as unknown as Context;

type Handler = (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<Record<string, unknown>>;

const createDraft =
	OutboxOperations.OutboxOperations_createOutboxMessage as Handler;
const sendMessage =
	OutboxDetailOperations.OutboxDetailOperations_sendOutboxMessage as Handler;
const updateDraft =
	OutboxDetailOperations.OutboxDetailOperations_updateOutboxMessage as Handler;
const deleteDraft =
	OutboxDetailOperations.OutboxDetailOperations_deleteOutboxMessage as Handler;
const getMessage =
	OutboxDetailOperations.OutboxDetailOperations_getOutboxMessage as Handler;

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
		requestContext({}),
		authorizedEvent({
			accountId: ACCOUNT_ID,
			toAddresses: ["recipient@example.com"],
			subject: "Re: the thing",
			textBody: "on it",
		}),
	);
	const outboxMessageId = draft.outboxMessageId;
	assert.equal(typeof outboxMessageId, "string");

	const sent = await sendMessage(
		requestContext({ params: { outboxMessageId: String(outboxMessageId) } }),
		authorizedEvent(),
	);
	assert.notEqual(sent.status, "draft");

	return String(outboxMessageId);
};

afterEach(() => {
	_resetForTest();
});

describe("an outbox entry that has left draft (#604)", () => {
	it("answers a late autosave PATCH with 409, never a 500", async () => {
		installClient();
		const outboxMessageId = await sentOutboxMessageId();

		const response = await respond(() =>
			updateDraft(
				requestContext({
					params: { outboxMessageId },
					requestBody: { subject: "Re: the thing", textBody: "on it!" },
				}),
				authorizedEvent(),
			),
		);

		assert.equal(response.statusCode, 409);
		const body = JSON.parse(response.body) as { message?: string };
		assert.match(String(body.message), /can no longer be edited/);
	});

	it("refuses a second send with 409, never a 500", async () => {
		installClient();
		const outboxMessageId = await sentOutboxMessageId();

		const response = await respond(() =>
			sendMessage(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
		);

		assert.equal(response.statusCode, 409);
	});

	it("refuses a discard with 409, never a 500", async () => {
		installClient();
		const outboxMessageId = await sentOutboxMessageId();

		const response = await respond(() =>
			deleteDraft(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
		);

		assert.equal(response.statusCode, 409);
	});

	it("still discards a message that was sent but never filed", async () => {
		installClient();
		const outboxMessageId = await sentOutboxMessageId();
		const client = await getClient();
		await client.outboxMessage.update(ACCOUNT_CONFIG_ID, outboxMessageId, {
			status: OutboxMessageStatus.unfiled,
		});

		const response = await respond(() =>
			deleteDraft(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
		);

		assert.equal(response.statusCode, 204);
	});

	it("still accepts an autosave PATCH while the entry is a draft", async () => {
		installClient();
		const draft = await createDraft(
			requestContext({}),
			authorizedEvent({
				accountId: ACCOUNT_ID,
				toAddresses: ["recipient@example.com"],
			}),
		);

		const response = await respond(() =>
			updateDraft(
				requestContext({
					params: { outboxMessageId: String(draft.outboxMessageId) },
					requestBody: { subject: "still editing" },
				}),
				authorizedEvent(),
			),
		);

		assert.equal(response.statusCode, 200);
		const body = JSON.parse(response.body) as { subject?: string };
		assert.equal(body.subject, "still editing");
	});
});

describe("a send whose enqueue fails (#845.8)", () => {
	const draftAgainstQueue = async (
		queue: SQSClient,
	): Promise<{ outboxMessageId: string; response: APIGatewayProxyResult }> => {
		installClient(queue);
		const draft = await createDraft(
			requestContext({}),
			authorizedEvent({
				accountId: ACCOUNT_ID,
				toAddresses: ["recipient@example.com"],
				subject: "the one that got stuck",
				textBody: "sending",
			}),
		);
		const outboxMessageId = String(draft.outboxMessageId);
		const response = await respond(() =>
			sendMessage(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
		);
		return { outboxMessageId, response };
	};

	const statusOf = async (outboxMessageId: string): Promise<unknown> => {
		const response = await respond(() =>
			getMessage(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
		);
		assert.equal(response.statusCode, 200);
		return (JSON.parse(response.body) as { status?: string }).status;
	};

	it("answers 500, never a success the send never had", async () => {
		const { response } = await draftAgainstQueue(refusingSqsClient().client);

		assert.equal(response.statusCode, 500);
	});

	it("settles the row at failed, not stranded at queued and not back at draft", async () => {
		const { outboxMessageId } = await draftAgainstQueue(
			refusingSqsClient().client,
		);

		// `queued` is the dead end this suite exists for. `draft` is the other
		// wrong answer: it is inside the SMTP worker's send fence, and an error
		// from SQS does not prove the event was refused — one that landed anyway
		// would send a row the user can still send by hand. `failed` is outside
		// the fence and, since #933, still editable and sendable.
		assert.equal(await statusOf(outboxMessageId), OutboxMessageStatus.failed);
	});

	it("still lets the user discard what could not be queued", async () => {
		const { outboxMessageId } = await draftAgainstQueue(
			refusingSqsClient().client,
		);

		const response = await respond(() =>
			deleteDraft(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
		);

		assert.equal(response.statusCode, 204);
	});

	it("sends once the queue comes back", async () => {
		const queue = refusingSqsClient();
		const { outboxMessageId } = await draftAgainstQueue(queue.client);
		queue.accept();

		const response = await respond(() =>
			sendMessage(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
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
		installClient();
		const storage = installedStorage;
		assert.ok(storage);

		const draft = await createDraft(
			requestContext({}),
			authorizedEvent({
				accountId: ACCOUNT_ID,
				toAddresses: ["recipient@example.com"],
			}),
		);
		const outboxMessageId = String(draft.outboxMessageId);

		const client = await getClient();
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
		assert.equal(attachmentRows.size, 1);

		const response = await respond(() =>
			deleteDraft(
				requestContext({ params: { outboxMessageId } }),
				authorizedEvent(),
			),
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
		assert.equal(attachmentRows.size, 0);
	});
});

describe("attachmentIds on a draft update (#679)", () => {
	const seed = async (): Promise<{
		outboxMessageId: string;
		ids: string[];
	}> => {
		const draft = await createDraft(
			requestContext({}),
			authorizedEvent({
				accountId: ACCOUNT_ID,
				toAddresses: ["recipient@example.com"],
			}),
		);
		const outboxMessageId = String(draft.outboxMessageId);
		const client = await getClient();
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
				authorizedEvent(),
			),
		);

	it("absent leaves the files alone — a subject-only save keeps them", async () => {
		installClient();
		const { outboxMessageId } = await seed();

		const response = await patch(outboxMessageId, { subject: "still typing" });

		assert.equal(response.statusCode, 200);
		const body = JSON.parse(response.body) as { attachments: unknown[] };
		assert.equal(body.attachments.length, 2);
		assert.equal(attachmentRows.size, 2);
	});

	it("present and empty removes every file", async () => {
		installClient();
		const { outboxMessageId } = await seed();

		const response = await patch(outboxMessageId, { attachmentIds: [] });

		assert.equal(response.statusCode, 200);
		assert.deepEqual(
			(JSON.parse(response.body) as { attachments: unknown[] }).attachments,
			[],
		);
		assert.equal(attachmentRows.size, 0);
	});

	it("present with ids keeps those and removes the rest, bytes included", async () => {
		installClient();
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
		installClient();
		const { outboxMessageId, ids } = await seed();

		const response = await patch(outboxMessageId, {
			attachmentIds: [...ids, "never-existed"],
		});

		assert.equal(response.statusCode, 200);
		assert.equal(attachmentRows.size, 2);
	});
});
