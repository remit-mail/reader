/**
 * Issue #679, phase 1: reserving room for a file, uploading it, and confirming
 * it landed.
 *
 * Driven through the real handlers, the real OutboxAttachmentService, a real
 * storage backend and the real error funnel, so what is asserted is the status
 * code and body the browser receives. The upload leg goes through the real
 * receiver against a URL the storage backend actually minted — nothing here
 * hand-builds a signature.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { OutboxMessageItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import {
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	OutboxAttachmentService,
} from "@remit/mailbox-service";
import {
	openStore,
	type Store,
} from "@remit/mailbox-service/test-helpers/test-store";
import {
	type StorageService,
	UPLOAD_ROUTE_PREFIX,
} from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context as LambdaContext,
} from "aws-lambda";
import type { Context } from "openapi-backend";
import { receiveUpload } from "../../dev-server/upload-handler.js";
import { testApiConfig } from "../config/test-config.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import { _resetForTest, type RemitClient } from "../service/data-client.js";
import type { HandlerContext } from "../types.js";
import {
	completeOutboxAttachment,
	mintOutboxAttachment,
} from "./outbox-attachment.js";

let client: RemitClient;

const SUB = "cognito-sub-679";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const OTHER_ACCOUNT_CONFIG_ID = deriveAccountConfigId("cognito-sub-stranger");
const ACCOUNT_ID = "acc-679";
let draftId: string;
const ORIGIN = "https://mail.example.test";
const SECRET = "a-signing-secret-of-at-least-32-characters";

interface Installed {
	storage: StorageService;
	basePath: string;
}

const temporaryRoots: string[] = [];
const attachmentStores: Store[] = [];

const install = async (
	overrides: Partial<OutboxMessageItem> = {},
	accountConfigId = ACCOUNT_CONFIG_ID,
): Promise<Installed> => {
	const basePath = await mkdtemp(join(process.cwd(), ".tmp-attachments-"));
	temporaryRoots.push(basePath);

	const storage = createFilesystemStorageService(basePath, {
		origin: ORIGIN,
		signingSecret: SECRET,
	});

	const attachmentStore = await openStore();
	attachmentStores.push(attachmentStore);
	const { outboxMessage } = attachmentStore;
	const draft = await outboxMessage.create({
		accountId: ACCOUNT_ID,
		accountConfigId,
		fromAddress: "sender@example.com",
		toAddresses: [],
		messageIdValue: "<draft@example.com>",
		status: OutboxMessageStatus.draft,
		...overrides,
	});
	draftId = draft.outboxMessageId;
	client = {
		outboxMessage,
		storage,
		outboxAttachment: new OutboxAttachmentService({
			outboxMessageService: outboxMessage,
			outboxAttachmentService: attachmentStore.outboxAttachment,
			storage,
		}),
	} as unknown as RemitClient;

	return { storage, basePath };
};

const caller = (): HandlerContext => ({
	client,
	config: testApiConfig(),
	identity: {
		kind: "user",
		accountConfigId: ACCOUNT_CONFIG_ID,
		sub: SUB,
		email: "caller@example.com",
	},
});

const mintContext = (
	body: Record<string, unknown>,
	outboxMessageId = draftId,
): Context =>
	({
		request: { params: { outboxMessageId }, requestBody: body },
	}) as unknown as Context;

const completeContext = (
	outboxAttachmentId: string,
	outboxMessageId = draftId,
): Context =>
	({
		request: { params: { outboxMessageId, outboxAttachmentId } },
	}) as unknown as Context;

/** The response the browser would receive, error funnel included. */
const respond = async (
	run: () => Promise<unknown>,
): Promise<APIGatewayProxyResult> => {
	const outcome = await run().then(
		(body) => ({ ok: true as const, body }),
		(error: unknown) => ({ ok: false as const, error }),
	);
	if (!outcome.ok) return handleError(outcome.error);
	return formatResponse(outcome.body as Record<string, unknown>);
};

const parse = (response: APIGatewayProxyResult): Record<string, unknown> =>
	JSON.parse(response.body) as Record<string, unknown>;

const mint = (
	body: Record<string, unknown>,
	outboxMessageId = draftId,
): Promise<APIGatewayProxyResult> =>
	respond(() =>
		mintOutboxAttachment(mintContext(body, outboxMessageId), caller()),
	);

const complete = (
	outboxAttachmentId: string,
	outboxMessageId = draftId,
): Promise<APIGatewayProxyResult> =>
	respond(() =>
		completeOutboxAttachment(
			completeContext(outboxAttachmentId, outboxMessageId),
			caller(),
		),
	);

/** PUT bytes to a minted URL through the real receiver. */
const putTo = (
	storage: StorageService,
	uploadUrl: string,
	content: Buffer,
	nowSeconds = Math.floor(Date.now() / 1000),
) => {
	const url = new URL(uploadUrl);
	return receiveUpload(storage, {
		storageKey: url.pathname.slice(UPLOAD_ROUTE_PREFIX.length),
		exp: url.searchParams.get("exp") ?? undefined,
		max: url.searchParams.get("max") ?? undefined,
		sig: url.searchParams.get("sig") ?? undefined,
		body: Readable.from(content),
		nowSeconds,
		secret: SECRET,
		findLiveReservation: async () => true,
	});
};

const mintedBody = (
	response: APIGatewayProxyResult,
): { outboxAttachmentId: string; uploadUrl: string } => {
	assert.equal(response.statusCode, 200);
	const body = parse(response);
	return {
		outboxAttachmentId: String(body.outboxAttachmentId),
		uploadUrl: String(body.uploadUrl),
	};
};

afterEach(async () => {
	_resetForTest();
	for (const store of attachmentStores.splice(0)) await store.close();
	for (const root of temporaryRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("reserving room on a draft (#679)", () => {
	it("answers with an upload URL scoped to one attachment on this draft", async () => {
		await install();

		const response = await mint({
			filename: "invoice.pdf",
			contentType: "application/pdf",
			sizeBytes: 2048,
		});

		assert.equal(response.statusCode, 200);
		const body = parse(response);
		assert.equal(body.outboxMessageId, draftId);
		assert.equal(body.filename, "invoice.pdf");
		assert.equal(body.contentType, "application/pdf");
		assert.equal(body.sizeBytes, 2048);
		assert.ok(Number(body.uploadExpiresAt) > Math.floor(Date.now() / 1000));

		const url = new URL(String(body.uploadUrl));
		assert.equal(url.origin, ORIGIN);
		assert.ok(url.pathname.includes(String(body.outboxAttachmentId)));
		assert.ok(url.pathname.includes(draftId));
		assert.equal(url.searchParams.get("max"), "2048");
		assert.ok((url.searchParams.get("sig") ?? "").length > 0);
	});

	it("sanitizes the filename it will put on the message", async () => {
		await install();

		const response = await mint({
			filename: "../../../etc/pa\u202Edwssap",
			contentType: "definitely not a media type",
			sizeBytes: 10,
		});

		assert.equal(response.statusCode, 200);
		const body = parse(response);
		assert.equal(body.filename, "padwssap");
		assert.equal(body.contentType, "application/octet-stream");
	});

	it("refuses a filename that is nothing but separators", async () => {
		await install();

		const response = await mint({
			filename: "../..",
			contentType: "text/plain",
			sizeBytes: 10,
		});

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.UnusableFilename,
		);
	});

	it("refuses a declared size over the cap with 413, before any bytes move", async () => {
		await install();

		const response = await mint({
			filename: "huge.bin",
			contentType: "application/octet-stream",
			sizeBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES + 1,
		});

		assert.equal(response.statusCode, 413);
		const body = parse(response);
		assert.equal(body.reason, OutboxAttachmentRejectionReason.FileTooLarge);
		assert.equal(body.limitBytes, OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES);
		assert.match(String(body.message), /huge\.bin/);
	});

	it("counts a reservation nobody has uploaded against yet", async () => {
		await install();

		const first = await mint({
			filename: "half.bin",
			contentType: "application/octet-stream",
			sizeBytes: OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024,
		});
		assert.equal(first.statusCode, 200);

		const second = await mint({
			filename: "one-too-many.bin",
			contentType: "application/octet-stream",
			sizeBytes: 2048,
		});

		assert.equal(second.statusCode, 413);
		const body = parse(second);
		assert.equal(body.reason, OutboxAttachmentRejectionReason.MessageTooLarge);
		assert.equal(body.usedBytes, OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 1024);
	});

	it("refuses an empty file", async () => {
		await install();

		const response = await mint({
			filename: "empty.txt",
			contentType: "text/plain",
			sizeBytes: 0,
		});

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.EmptyFile,
		);
	});

	it("denies a mint against someone else's draft, and reserves nothing", async () => {
		const { storage } = await install({}, OTHER_ACCOUNT_CONFIG_ID);

		const response = await mint({
			filename: "trespass.txt",
			contentType: "text/plain",
			sizeBytes: 10,
		});

		assert.equal(response.statusCode, 403);
		assert.deepEqual(
			await storage.listOutboxAttachments(
				OTHER_ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
			),
			[],
		);
	});

	it("answers 404 for a draft that does not exist", async () => {
		await install();

		const response = await mint(
			{ filename: "orphan.txt", contentType: "text/plain", sizeBytes: 10 },
			"z9y8x7w6v5u4t3s2r1q0p9o8n",
		);

		assert.equal(response.statusCode, 404);
	});

	it("refuses to reserve on a message that has already left draft", async () => {
		await install({ status: OutboxMessageStatus.sent });

		const response = await mint({
			filename: "late.txt",
			contentType: "text/plain",
			sizeBytes: 10,
		});

		assert.equal(response.statusCode, 409);
		assert.match(
			String(parse(response).message),
			/no longer take an attachment/,
		);
	});
});

describe("uploading to a minted URL (#679)", () => {
	it("stores the bytes, and the completion answers with the size storage holds", async () => {
		const { storage } = await install();
		const content = Buffer.from("%PDF-1.7 a small invoice");
		const { outboxAttachmentId, uploadUrl } = mintedBody(
			await mint({
				filename: "invoice.pdf",
				contentType: "application/pdf",
				sizeBytes: content.length,
			}),
		);

		const upload = await putTo(storage, uploadUrl, content);
		assert.equal(upload.status, 204);

		const response = await complete(outboxAttachmentId);
		assert.equal(response.statusCode, 200);
		const body = parse(response);
		assert.equal(body.outboxAttachmentId, outboxAttachmentId);
		assert.equal(body.sizeBytes, content.length);

		const stat = await storage.statOutboxAttachment(
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			draftId,
			outboxAttachmentId,
		);
		assert.equal(stat?.sizeBytes, content.length);
	});

	it("refuses a forged signature and writes nothing", async () => {
		const { storage } = await install();
		const { outboxAttachmentId, uploadUrl } = mintedBody(
			await mint({
				filename: "forged.bin",
				contentType: "application/octet-stream",
				sizeBytes: 4,
			}),
		);

		const tampered = new URL(uploadUrl);
		tampered.searchParams.set("sig", "not-the-signature");

		const upload = await putTo(storage, tampered.toString(), Buffer.alloc(4));
		assert.equal(upload.status, 403);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				outboxAttachmentId,
			),
			null,
		);
	});

	it("refuses a URL whose size was raised after it was minted", async () => {
		const { storage } = await install();
		const { uploadUrl } = mintedBody(
			await mint({
				filename: "grown.bin",
				contentType: "application/octet-stream",
				sizeBytes: 4,
			}),
		);

		// The byte count is part of the signed message, so raising it invalidates
		// the URL rather than raising the allowance.
		const tampered = new URL(uploadUrl);
		tampered.searchParams.set("max", "40000");

		const upload = await putTo(
			storage,
			tampered.toString(),
			Buffer.alloc(4000),
		);
		assert.equal(upload.status, 403);
	});

	it("refuses a URL pointed at a different attachment", async () => {
		const { storage } = await install();
		const first = mintedBody(
			await mint({
				filename: "mine.bin",
				contentType: "application/octet-stream",
				sizeBytes: 4,
			}),
		);
		const second = mintedBody(
			await mint({
				filename: "theirs.bin",
				contentType: "application/octet-stream",
				sizeBytes: 4,
			}),
		);

		const swapped = new URL(first.uploadUrl);
		swapped.pathname = new URL(second.uploadUrl).pathname;

		const upload = await putTo(storage, swapped.toString(), Buffer.alloc(4));
		assert.equal(upload.status, 403);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				second.outboxAttachmentId,
			),
			null,
		);
	});

	it("refuses an expired URL", async () => {
		const { storage } = await install();
		const { outboxAttachmentId, uploadUrl } = mintedBody(
			await mint({
				filename: "stale.bin",
				contentType: "application/octet-stream",
				sizeBytes: 4,
			}),
		);

		const upload = await putTo(
			storage,
			uploadUrl,
			Buffer.alloc(4),
			Math.floor(Date.now() / 1000) + 100_000,
		);
		assert.equal(upload.status, 403);
		assert.equal(upload.reason, "expired");
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				outboxAttachmentId,
			),
			null,
		);
	});

	it("cuts off a body larger than was reserved, and stores none of it", async () => {
		const { storage } = await install();
		const { outboxAttachmentId, uploadUrl } = mintedBody(
			await mint({
				filename: "sneaky.bin",
				contentType: "application/octet-stream",
				sizeBytes: 1024,
			}),
		);

		const upload = await putTo(storage, uploadUrl, Buffer.alloc(64 * 1024));
		assert.equal(upload.status, 413);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				outboxAttachmentId,
			),
			null,
		);
	});

	it("refuses a body shorter than was reserved", async () => {
		const { storage } = await install();
		const { uploadUrl } = mintedBody(
			await mint({
				filename: "short.bin",
				contentType: "application/octet-stream",
				sizeBytes: 1024,
			}),
		);

		const upload = await putTo(storage, uploadUrl, Buffer.alloc(16));
		assert.equal(upload.status, 400);
		assert.equal(upload.reason, "size-mismatch");
	});
});

describe("completing an attachment (#679)", () => {
	it("refuses to complete when nothing was ever uploaded", async () => {
		await install();
		const { outboxAttachmentId } = mintedBody(
			await mint({
				filename: "never-sent.bin",
				contentType: "application/octet-stream",
				sizeBytes: 8,
			}),
		);

		const response = await complete(outboxAttachmentId);

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.UploadMissing,
		);
	});

	it("refuses to complete an attachment that was never reserved", async () => {
		await install();

		const response = await complete("never-minted");

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.ReservationExpired,
		);
	});

	it("refuses, and removes, an object that is not the size reserved for it", async () => {
		const { storage } = await install();
		const { outboxAttachmentId } = mintedBody(
			await mint({
				filename: "mismatched.bin",
				contentType: "application/octet-stream",
				sizeBytes: 4096,
			}),
		);

		// Write past the upload route, the way a hosted deployment's block storage
		// could end up holding something other than what was announced.
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId: draftId,
			outboxAttachmentId,
			content: Buffer.alloc(9),
		});

		const response = await complete(outboxAttachmentId);

		assert.equal(response.statusCode, 400);
		assert.equal(
			parse(response).reason,
			OutboxAttachmentRejectionReason.SizeMismatch,
		);
		assert.equal(
			await storage.statOutboxAttachment(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				draftId,
				outboxAttachmentId,
			),
			null,
		);
	});
});

describe("mint and renewal through the whole request pipeline", () => {
	it("routes creation and bodyless renewal with the real built spec", async () => {
		await install();
		const handleApiEvent = (await import("../api-fixture.js")).lambdaHandler(
			async () => client,
			testApiConfig(),
		);

		const body = JSON.stringify({
			filename: "routed.txt",
			contentType: "text/plain",
			sizeBytes: 18,
		});
		const event = {
			httpMethod: "POST",
			path: `/outbox/${draftId}/attachments`,
			body,
			headers: { "content-type": "application/json" },
			requestContext: {
				authorizer: { claims: { sub: SUB, email: "caller@example.com" } },
			},
		};

		const result = await handleApiEvent(
			event as unknown as APIGatewayProxyEvent,
			{ awsRequestId: "mint-route-test" } as LambdaContext,
		);

		assert.equal(result.statusCode, 200);
		const created = parse(result);
		assert.equal(created.filename, "routed.txt");
		const renewed = await handleApiEvent(
			{
				...event,
				path: `/outbox/${draftId}/attachments/${created.outboxAttachmentId}/renew`,
				body: null,
			} as unknown as APIGatewayProxyEvent,
			{ awsRequestId: "renew-route-test" } as LambdaContext,
		);
		assert.equal(renewed.statusCode, 200);
		assert.equal(parse(renewed).outboxAttachmentId, created.outboxAttachmentId);
		const reservation = parse(renewed);
		assert.equal(reservation.filename, "routed.txt");
		assert.equal(reservation.contentType, "text/plain");
		assert.equal(reservation.sizeBytes, 18);
		assert.equal(
			new URL(String(reservation.uploadUrl)).searchParams.get("max"),
			"18",
		);
	});
});
