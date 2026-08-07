/**
 * Issue #679: the upload route through the real express stack.
 *
 * The handler-level tests call `receiveUpload` directly, which is exactly the
 * gap that let a JSON-typed attachment upload zero bytes: `express.json` drains
 * the stream before any route sees it, and calling the receiver by hand never
 * meets that middleware. These go through the app.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	type StorageService,
	UPLOAD_ROUTE_PREFIX,
} from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import express, { type Request, type Response } from "express";
import { receiveUpload } from "./upload-handler.js";

const SECRET = "a-signing-secret-of-at-least-32-characters";
const ORIGIN = "http://127.0.0.1";

let storage: StorageService;
let basePath: string;
let server: Server;
let port: number;

/**
 * The dev-server's own middleware order, reproduced: the PUT is registered
 * ahead of the body parsers, which is the whole point. Registering it after
 * them is what silently emptied a JSON-typed upload.
 */
const buildApp = () => {
	const app = express();
	app.put(
		new RegExp(`^${UPLOAD_ROUTE_PREFIX}.+$`),
		async (req: Request, res: Response) => {
			const result = await receiveUpload(storage, {
				storageKey: req.path.slice(UPLOAD_ROUTE_PREFIX.length),
				exp: typeof req.query.exp === "string" ? req.query.exp : undefined,
				max: typeof req.query.max === "string" ? req.query.max : undefined,
				sig: typeof req.query.sig === "string" ? req.query.sig : undefined,
				body: req,
				nowSeconds: Math.floor(Date.now() / 1000),
				secret: SECRET,
			});
			res.setHeader("x-remit-upload-reason", result.reason);
			res.status(result.status);
			res.send(result.status === 204 ? undefined : result.reason);
		},
	);
	app.use(express.json({ limit: "10mb" }));
	app.use(express.urlencoded({ extended: true }));
	return app;
};

const reserve = async (
	outboxAttachmentId: string,
	sizeBytes: number,
): Promise<string> => {
	const expiresAt = Math.floor(Date.now() / 1000) + 900;
	const { version } = await storage.readOutboxLedger("cfg1", "acc1", "draft1");
	await storage.writeOutboxLedger(
		"cfg1",
		"acc1",
		"draft1",
		{
			entries: [
				{
					outboxAttachmentId,
					filename: `${outboxAttachmentId}.bin`,
					contentType: "application/octet-stream",
					sizeBytes,
					expiresAt,
					uploaded: false,
				},
			],
		},
		version,
	);
	const { uploadUrl } = await storage.createOutboxAttachmentUploadUrl({
		accountConfigId: "cfg1",
		accountId: "acc1",
		outboxMessageId: "draft1",
		outboxAttachmentId,
		sizeBytes,
		expiresAt,
	});
	const url = new URL(uploadUrl);
	return `http://127.0.0.1:${port}${url.pathname}${url.search}`;
};

before(async () => {
	basePath = await mkdtemp(join(tmpdir(), "remit-upload-route-"));
	storage = createFilesystemStorageService(basePath, {
		origin: ORIGIN,
		signingSecret: SECRET,
	});
	server = createServer(buildApp());
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	port = typeof address === "object" && address ? address.port : 0;
});

after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(basePath, { recursive: true, force: true });
});

describe("PUT /outbox-upload through the express stack", () => {
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
			(await storage.statOutboxAttachment("cfg1", "acc1", "draft1", "attjson"))
				?.sizeBytes,
			content.length,
		);
	});

	it("stores every byte of a form-urlencoded-looking upload too", async () => {
		const content = Buffer.from("a=1&b=2&c=".concat("z".repeat(200)));
		const url = await reserve("attform", content.length);

		const response = await fetch(url, {
			method: "PUT",
			body: content,
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});

		assert.equal(response.status, 204);
		assert.equal(
			(await storage.statOutboxAttachment("cfg1", "acc1", "draft1", "attform"))
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
			(await storage.statOutboxAttachment("cfg1", "acc1", "draft1", "attpng"))
				?.sizeBytes,
			content.length,
		);
	});

	it("refuses a PUT whose draft no longer has a live reservation", async () => {
		const url = await reserve("attgone", 8);
		await storage.deleteOutboxAttachments("cfg1", "acc1", "draft1");

		const response = await fetch(url, {
			method: "PUT",
			body: Buffer.alloc(8),
			headers: { "content-type": "application/octet-stream" },
		});

		assert.equal(response.status, 409);
		assert.equal(
			await storage.statOutboxAttachment("cfg1", "acc1", "draft1", "attgone"),
			null,
		);
	});
});
