/**
 * Issue #679, phase 1: `POST /outbox/{outboxMessageId}/attachments`.
 *
 * Driven through the real handler, the real multipart reader, the real
 * OutboxAttachmentService, the real storage service and the real error funnel,
 * so what is asserted is the status code and body the browser receives. Every
 * request carries a genuine `multipart/form-data` payload, encoded the way the
 * dev-server and API Gateway both deliver one — base64 with `isBase64Encoded`.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	CreateOutboxMessageInput,
	IOutboxMessageRepository,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/data-ports";
import { ForbiddenError, NotFoundError } from "@remit/data-ports/errors";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import {
	OUTBOX_ATTACHMENT_MAX_COUNT,
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	OutboxAttachmentService,
} from "@remit/mailbox-service";
import {
	buildOutboxAttachmentKey,
	computeChecksum,
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
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { uploadOutboxAttachment } from "./outbox-attachment.js";

const SUB = "cognito-sub-679";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const OTHER_ACCOUNT_CONFIG_ID = deriveAccountConfigId("cognito-sub-stranger");
const ACCOUNT_ID = "acc-679";
const DRAFT_ID = "outbox-679";

const createOutboxRepository = (
	rows: Map<string, OutboxMessageItem>,
): IOutboxMessageRepository =>
	({
		get: async (
			accountConfigId: string,
			outboxMessageId: string,
			mode?: "read" | "act",
		) => {
			const row = rows.get(outboxMessageId);
			if (!row) throw new NotFoundError(`No outbox message ${outboxMessageId}`);
			if (row.accountConfigId !== accountConfigId) {
				// Mirrors the real repository: an action verb denies, a read feigns
				// absence.
				if (mode === "act") {
					throw new ForbiddenError(
						`Outbox message ${outboxMessageId} not in account config`,
					);
				}
				throw new NotFoundError(`No outbox message ${outboxMessageId}`);
			}
			return row;
		},
		create: async (input: CreateOutboxMessageInput) =>
			input as OutboxMessageItem,
		update: async (
			_accountConfigId: string,
			outboxMessageId: string,
			input: UpdateOutboxMessageInput,
		) => ({ ...rows.get(outboxMessageId), ...input }) as OutboxMessageItem,
	}) as unknown as IOutboxMessageRepository;

interface Installed {
	storage: StorageService;
	rows: Map<string, OutboxMessageItem>;
}

const install = (
	overrides: Partial<OutboxMessageItem> = {},
	accountConfigId = ACCOUNT_CONFIG_ID,
): Installed => {
	const rows = new Map<string, OutboxMessageItem>([
		[
			DRAFT_ID,
			{
				outboxMessageId: DRAFT_ID,
				accountId: ACCOUNT_ID,
				accountConfigId,
				status: OutboxMessageStatus.draft,
				...overrides,
			} as OutboxMessageItem,
		],
	]);
	const outboxMessage = createOutboxRepository(rows);
	const storage = createMockStorageService();

	setClient({
		outboxMessage,
		storage,
		outboxAttachment: new OutboxAttachmentService({
			outboxMessageService: outboxMessage,
			storage,
		}),
	} as unknown as RemitClient);

	return { storage, rows };
};

/** A real multipart body, encoded the way the transport delivers one. */
const multipartEvent = async (
	file: { name: string; type: string; bytes: Buffer } | null,
): Promise<APIGatewayProxyEvent> => {
	const form = new FormData();
	if (file) {
		form.set(
			"file",
			new File([Uint8Array.from(file.bytes)], file.name, { type: file.type }),
		);
	} else {
		form.set("notes", "no file here");
	}
	const request = new Request("http://backend/upload", {
		method: "POST",
		body: form,
	});
	const body = Buffer.from(await request.arrayBuffer());

	return {
		httpMethod: "POST",
		body: body.toString("base64"),
		isBase64Encoded: true,
		headers: { "content-type": request.headers.get("content-type") ?? "" },
		requestContext: { authorizer: { claims: { sub: SUB } } },
	} as unknown as APIGatewayProxyEvent;
};

const rawEvent = (body: string, contentType: string): APIGatewayProxyEvent =>
	({
		httpMethod: "POST",
		body: Buffer.from(body, "utf8").toString("base64"),
		isBase64Encoded: true,
		headers: { "content-type": contentType },
		requestContext: { authorizer: { claims: { sub: SUB } } },
	}) as unknown as APIGatewayProxyEvent;

const requestContext = (outboxMessageId = DRAFT_ID): Context =>
	({ request: { params: { outboxMessageId } } }) as unknown as Context;

/** The response the browser would receive, error funnel included. */
const respond = async (
	event: APIGatewayProxyEvent,
	outboxMessageId = DRAFT_ID,
): Promise<APIGatewayProxyResult> => {
	const outcome = await uploadOutboxAttachment(
		requestContext(outboxMessageId),
		event,
	).then(
		(body) => ({ ok: true as const, body }),
		(error: unknown) => ({ ok: false as const, error }),
	);
	if (!outcome.ok) return handleError(outcome.error);
	return formatResponse(outcome.body as unknown as Record<string, unknown>);
};

const parse = (response: APIGatewayProxyResult): Record<string, unknown> =>
	JSON.parse(response.body) as Record<string, unknown>;

afterEach(() => {
	_resetForTest();
});

describe("uploading a file to a draft (#679)", () => {
	it("stores the bytes under the draft's own key and answers with the descriptor", async () => {
		const { storage } = install();
		const bytes = Buffer.from("%PDF-1.7 a small invoice");

		const response = await respond(
			await multipartEvent({
				name: "invoice.pdf",
				type: "application/pdf",
				bytes,
			}),
		);

		assert.equal(response.statusCode, 200);
		const body = parse(response);
		assert.equal(body.outboxMessageId, DRAFT_ID);
		assert.equal(body.filename, "invoice.pdf");
		assert.equal(body.contentType, "application/pdf");
		assert.equal(body.sizeBytes, bytes.length);
		assert.equal(body.checksumSha256, computeChecksum(bytes));

		const stored = await storage.retrieve(
			`mock://${buildOutboxAttachmentKey(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				DRAFT_ID,
				String(body.outboxAttachmentId),
			)}`,
		);
		assert.deepEqual(stored, bytes);
	});

	it("records an unusable media type as octet-stream rather than refusing the file", async () => {
		install();

		const response = await respond(
			await multipartEvent({
				name: "notes.txt",
				type: "definitely not a media type",
				bytes: Buffer.from("hello"),
			}),
		);

		assert.equal(response.statusCode, 200);
		assert.equal(parse(response).contentType, "application/octet-stream");
	});

	it("keeps only the basename of a traversing filename and stores nothing under it", async () => {
		const { storage } = install();

		const response = await respond(
			await multipartEvent({
				name: "../../../etc/pa\u202Edwssap",
				type: "text/plain",
				bytes: Buffer.from("root:x:0:0"),
			}),
		);

		assert.equal(response.statusCode, 200);
		const body = parse(response);
		assert.equal(body.filename, "padwssap");
		assert.match(String(body.outboxAttachmentId), /^[a-z0-9]+$/);
		assert.ok(
			await storage.exists(
				`mock://${buildOutboxAttachmentKey(
					ACCOUNT_CONFIG_ID,
					ACCOUNT_ID,
					DRAFT_ID,
					String(body.outboxAttachmentId),
				)}`,
			),
		);
	});

	it("refuses a filename that is nothing but separators, naming why", async () => {
		install();

		const response = await respond(
			await multipartEvent({
				name: "../..",
				type: "text/plain",
				bytes: Buffer.from("x"),
			}),
		);

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.UnusableFilename,
		);
	});

	it("refuses a file over the cap with 413 and the cap in the body", async () => {
		install();

		const response = await respond(
			await multipartEvent({
				name: "huge.bin",
				type: "application/octet-stream",
				bytes: Buffer.alloc(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES + 1),
			}),
		);

		assert.equal(response.statusCode, 413);
		const body = parse(response);
		assert.equal(body.reason, OutboxAttachmentRejectionReason.FileTooLarge);
		assert.equal(body.limitBytes, OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES);
		assert.match(String(body.message), /huge\.bin/);
	});

	it("refuses a file that fits alone but pushes the message over the cap", async () => {
		const { storage } = install();
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: "already-there",
			content: Buffer.alloc(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024),
		});

		const response = await respond(
			await multipartEvent({
				name: "one-too-many.bin",
				type: "application/octet-stream",
				bytes: Buffer.alloc(2048),
			}),
		);

		assert.equal(response.statusCode, 413);
		const body = parse(response);
		assert.equal(body.reason, OutboxAttachmentRejectionReason.MessageTooLarge);
		assert.equal(body.usedBytes, OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024);
	});

	it("refuses a file once the draft already holds the most it can", async () => {
		const { storage } = install();
		for (let index = 0; index < OUTBOX_ATTACHMENT_MAX_COUNT; index += 1) {
			await storage.storeOutboxAttachment({
				accountConfigId: ACCOUNT_CONFIG_ID,
				accountId: ACCOUNT_ID,
				outboxMessageId: DRAFT_ID,
				outboxAttachmentId: `existing-${index}`,
				content: Buffer.from("x"),
			});
		}

		const response = await respond(
			await multipartEvent({
				name: "one-more.txt",
				type: "text/plain",
				bytes: Buffer.from("x"),
			}),
		);

		assert.equal(response.statusCode, 413);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.TooManyAttachments,
		);
	});

	it("refuses an empty file", async () => {
		install();

		const response = await respond(
			await multipartEvent({
				name: "empty.txt",
				type: "text/plain",
				bytes: Buffer.alloc(0),
			}),
		);

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.EmptyFile,
		);
	});

	it("refuses a payload that carries no file part", async () => {
		install();

		const response = await respond(await multipartEvent(null));

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.MissingFile,
		);
	});

	it("refuses a body that is not multipart at all", async () => {
		install();

		const response = await respond(
			rawEvent(JSON.stringify({ file: "pretend" }), "application/json"),
		);

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.MalformedUpload,
		);
	});

	it("refuses a multipart body whose boundary never closes", async () => {
		install();

		const response = await respond(
			rawEvent(
				'--zzz\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\n\r\ntruncated',
				"multipart/form-data; boundary=zzz",
			),
		);

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.MalformedUpload,
		);
	});

	it("denies an upload against someone else's draft, and writes nothing", async () => {
		const { storage } = install({}, OTHER_ACCOUNT_CONFIG_ID);

		const response = await respond(
			await multipartEvent({
				name: "trespass.txt",
				type: "text/plain",
				bytes: Buffer.from("not mine"),
			}),
		);

		assert.equal(response.statusCode, 403);
		assert.deepEqual(
			await storage.listOutboxAttachments(
				OTHER_ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				DRAFT_ID,
				10,
			),
			[],
		);
	});

	it("answers 404 for a draft that does not exist", async () => {
		install();

		const response = await respond(
			await multipartEvent({
				name: "orphan.txt",
				type: "text/plain",
				bytes: Buffer.from("x"),
			}),
			"outbox-nonexistent",
		);

		assert.equal(response.statusCode, 404);
	});

	it("refuses an attachment on a message that has already left draft", async () => {
		install({ status: OutboxMessageStatus.sent });

		const response = await respond(
			await multipartEvent({
				name: "late.txt",
				type: "text/plain",
				bytes: Buffer.from("too late"),
			}),
		);

		assert.equal(response.statusCode, 409);
		assert.match(
			String(parse(response).message),
			/no longer take an attachment/,
		);
	});
});

describe("the upload route through the whole request pipeline", () => {
	it("reaches its handler instead of failing schema validation on a binary body", async () => {
		install();
		const { api } = await import("../index.js");

		const event = await multipartEvent({
			name: "routed.txt",
			type: "text/plain",
			bytes: Buffer.from("through the router"),
		});
		event.httpMethod = "POST";
		event.path = `/outbox/${DRAFT_ID}/attachments`;

		const result = (await api.handleRequest(
			{
				method: "POST",
				path: event.path,
				query: {},
				body: event.body,
				headers: event.headers as Record<string, string>,
			},
			event,
			{} as never,
		)) as APIGatewayProxyResult;

		assert.equal(result.statusCode, 200);
		assert.equal(parse(result).filename, "routed.txt");
	});
});
