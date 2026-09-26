import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutboxAttachmentItem } from "@remit/data-ports";
import { createMockStorageService } from "@remit/storage-service";
import {
	createAttachmentLoader,
	createAttachmentReader,
} from "./attachment-storage.js";

describe("createAttachmentReader", () => {
	it("refuses to read on a Lambda with no bucket, naming the missing setting", () => {
		let created = 0;
		const reader = createAttachmentReader(
			{ AWS_LAMBDA_FUNCTION_NAME: "smtp-worker" },
			() => {
				created += 1;
				return createMockStorageService();
			},
		);

		assert.throws(
			() => reader.retrieveOutboxAttachment("cfg", "acc", "ob", "att"),
			/S3_BUCKET_NAME is not set on this worker/,
		);
		assert.equal(created, 0, "no filesystem fallback was built");
	});

	it("reads through storage built once, on first use", async () => {
		const storage = createMockStorageService();
		await storage.storeOutboxAttachment({
			accountConfigId: "cfg",
			accountId: "acc",
			outboxMessageId: "ob",
			outboxAttachmentId: "att",
			content: Buffer.from("bytes"),
		});
		let created = 0;
		const reader = createAttachmentReader(
			{ AWS_LAMBDA_FUNCTION_NAME: "smtp-worker", S3_BUCKET_NAME: "bucket" },
			() => {
				created += 1;
				return storage;
			},
		);

		assert.equal(
			String(await reader.retrieveOutboxAttachment("cfg", "acc", "ob", "att")),
			"bytes",
		);
		await reader.retrieveOutboxAttachment("cfg", "acc", "ob", "att");
		assert.equal(created, 1);
	});
});

describe("createAttachmentLoader", () => {
	it("reads the draft's stored files for the tenant it is given", async () => {
		const storage = createMockStorageService();
		await storage.storeOutboxAttachment({
			accountConfigId: "cfg",
			accountId: "acc",
			outboxMessageId: "ob",
			outboxAttachmentId: "att",
			content: Buffer.from("%PDF"),
		});
		const row: OutboxAttachmentItem = {
			outboxAttachmentId: "att",
			outboxMessageId: "ob",
			accountId: "acc",
			accountConfigId: "cfg",
			filename: "report.pdf",
			contentType: "application/pdf",
			sizeBytes: 4,
			state: "Stored",
			storageKey: "k",
			reservationExpiresAt: 0,
			createdAt: 0,
			updatedAt: 0,
		};
		const asked: string[][] = [];
		const load = createAttachmentLoader(
			storage,
			async () => ({
				listByOutboxMessage: async (accountConfigId, outboxMessageId) => {
					asked.push([accountConfigId, outboxMessageId]);
					return [row];
				},
			}),
			() => 1_000_000,
		);

		const files = await load(
			{ accountConfigId: "cfg", accountId: "acc" },
			"ob",
		);

		assert.deepEqual(asked, [["cfg", "ob"]]);
		assert.deepEqual(
			files.map((file) => [
				file.filename,
				file.contentType,
				String(file.content),
			]),
			[["report.pdf", "application/pdf", "%PDF"]],
		);
	});
});
