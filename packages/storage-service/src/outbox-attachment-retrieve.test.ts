import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import { createMockStorageService, type StorageService } from "./storage.js";

const OWNER = {
	accountConfigId: "cfg-1",
	accountId: "acc-1",
	outboxMessageId: "ob-1",
};

const readsBackWhatWasStored = async (storage: StorageService) => {
	const content = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
	await storage.storeOutboxAttachment({
		...OWNER,
		outboxAttachmentId: "att-1",
		content,
	});

	assert.deepEqual(
		await storage.retrieveOutboxAttachment(
			OWNER.accountConfigId,
			OWNER.accountId,
			OWNER.outboxMessageId,
			"att-1",
		),
		content,
	);
	assert.equal(
		await storage.retrieveOutboxAttachment(
			OWNER.accountConfigId,
			OWNER.accountId,
			OWNER.outboxMessageId,
			"att-missing",
		),
		null,
	);
};

describe("retrieveOutboxAttachment", () => {
	it("reads back the exact bytes on the filesystem backend, and null for none", async () => {
		const basePath = await mkdtemp(join(tmpdir(), "remit-outbox-retrieve-"));
		try {
			await readsBackWhatWasStored(createFilesystemStorageService(basePath));
		} finally {
			await rm(basePath, { recursive: true, force: true });
		}
	});

	it("reads back the exact bytes on the mock backend, and null for none", async () => {
		await readsBackWhatWasStored(createMockStorageService());
	});
});
