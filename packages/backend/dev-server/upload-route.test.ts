/**
 * Issue #679: the upload route through the real dev-server app.
 *
 * Not a copy of its middleware order — the app object itself, imported from
 * `server.ts`. A copy is what let a JSON-typed upload silently read zero bytes:
 * `express.json` drains the stream before any route below it sees the body, and
 * a test that rebuilds the stack stays green when the real one is reordered.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type {
	IOutboxAttachmentRepository,
	OutboxAttachmentItem,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { OutboxAttachmentService } from "@remit/mailbox-service";
import {
	type StorageService,
	UPLOAD_ROUTE_PREFIX,
} from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../src/service/data-client.js";

const SECRET = "a-signing-secret-of-at-least-32-characters";
const CFG = "cfg-upload";
const ACC = "acc-upload";
const DRAFT = "draft-upload";

let storage: StorageService;
let basePath: string;
let rows: Map<string, OutboxAttachmentItem>;
let server: Server;
let port: number;

const repository = (): IOutboxAttachmentRepository =>
	({
		get: async (accountConfigId: string, outboxAttachmentId: string) => {
			const row = rows.get(outboxAttachmentId);
			if (!row || row.accountConfigId !== accountConfigId) {
				throw new NotFoundError("gone");
			}
			return row;
		},
		listByOutboxMessage: async () => [...rows.values()],
	}) as unknown as IOutboxAttachmentRepository;

const reserve = async (
	outboxAttachmentId: string,
	sizeBytes: number,
): Promise<string> => {
	const expiresAt = Math.floor(Date.now() / 1000) + 900;
	rows.set(outboxAttachmentId, {
		outboxAttachmentId,
		outboxMessageId: DRAFT,
		accountId: ACC,
		accountConfigId: CFG,
		filename: `${outboxAttachmentId}.bin`,
		contentType: "application/octet-stream",
		sizeBytes,
		state: "Pending",
		storageKey: "",
		reservationExpiresAt: expiresAt,
		createdAt: 0,
		updatedAt: 0,
	});
	const { uploadUrl } = await storage.createOutboxAttachmentUploadUrl({
		accountConfigId: CFG,
		accountId: ACC,
		outboxMessageId: DRAFT,
		outboxAttachmentId,
		sizeBytes,
		expiresAt,
	});
	const url = new URL(uploadUrl);
	return `http://127.0.0.1:${port}${url.pathname}${url.search}`;
};

before(async () => {
	// Repo-local scratch, not the machine's shared temp directory.
	basePath = await mkdtemp(join(process.cwd(), ".tmp-upload-route-"));
	storage = createFilesystemStorageService(basePath, {
		origin: "http://127.0.0.1",
		signingSecret: SECRET,
	});
	rows = new Map();

	setClient({
		storage,
		outboxAttachment: new OutboxAttachmentService({
			outboxMessageService: {} as never,
			outboxAttachmentService: repository(),
			storage,
		}),
	} as unknown as RemitClient);

	process.env.BETTER_AUTH_SECRET = SECRET;
	// Port 0: the app binds whatever is free and tells us which.
	process.env.SERVER_PORT = "0";
	process.env.CORS_ALLOWED_ORIGINS = "*";

	const imported = await import("./server.js");
	server = imported.listener;
	if (!server.listening) {
		await new Promise<void>((resolve) => server.once("listening", resolve));
	}
	const address = server.address();
	port = typeof address === "object" && address ? address.port : 0;
});

after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(basePath, { recursive: true, force: true });
	_resetForTest();
});

describe("PUT /outbox-upload through the dev-server's own app", () => {
	it("stores every byte of a file the browser labelled application/json", async () => {
		const content = Buffer.from(JSON.stringify({ note: "x".repeat(100) }));
		const url = await reserve("attjson", content.length);

		const response = await fetch(url, {
			method: "PUT",
			body: content,
			// What `fetch(url, { body: file })` sends for a .json file: File.type.
			headers: { "content-type": "application/json" },
		});

		assert.equal(response.status, 204);
		assert.equal(
			(await storage.statOutboxAttachment(CFG, ACC, DRAFT, "attjson"))
				?.sizeBytes,
			content.length,
		);
	});

	it("stores every byte of a form-urlencoded-looking upload too", async () => {
		const content = Buffer.from(`a=1&b=2&c=${"z".repeat(200)}`);
		const url = await reserve("attform", content.length);

		const response = await fetch(url, {
			method: "PUT",
			body: content,
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});

		assert.equal(response.status, 204);
		assert.equal(
			(await storage.statOutboxAttachment(CFG, ACC, DRAFT, "attform"))
				?.sizeBytes,
			content.length,
		);
	});

	it("stores binary unchanged", async () => {
		const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
		const url = await reserve("attpng", content.length);

		const response = await fetch(url, {
			method: "PUT",
			body: content,
			headers: { "content-type": "image/png" },
		});

		assert.equal(response.status, 204);
		assert.equal(
			(await storage.statOutboxAttachment(CFG, ACC, DRAFT, "attpng"))
				?.sizeBytes,
			content.length,
		);
	});

	it("refuses a PUT once the draft no longer has a live reservation", async () => {
		const url = await reserve("attgone", 8);
		rows.delete("attgone");

		const response = await fetch(url, {
			method: "PUT",
			body: Buffer.alloc(8),
			headers: { "content-type": "application/octet-stream" },
		});

		assert.equal(response.status, 409);
		assert.equal(
			await storage.statOutboxAttachment(CFG, ACC, DRAFT, "attgone"),
			null,
		);
	});
});
