import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMockStorageService } from "@remit/storage-service";
import { createAttachmentReader } from "./attachment-storage.js";

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
