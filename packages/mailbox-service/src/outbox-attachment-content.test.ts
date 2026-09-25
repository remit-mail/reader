import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OutboxAttachmentItem } from "@remit/data-ports";
import { createMockStorageService } from "@remit/storage-service";
import { loadOutboxAttachmentContents } from "./outbox-attachment-content.js";

const OWNER = {
	accountConfigId: "cfg-1",
	accountId: "acc-1",
	outboxMessageId: "ob-1",
};
const NOW = 1_000;

const row = (
	outboxAttachmentId: string,
	overrides: Partial<OutboxAttachmentItem> = {},
): OutboxAttachmentItem => ({
	outboxAttachmentId,
	outboxMessageId: OWNER.outboxMessageId,
	accountId: OWNER.accountId,
	accountConfigId: OWNER.accountConfigId,
	filename: `${outboxAttachmentId}.txt`,
	contentType: "text/plain",
	sizeBytes: 5,
	state: "Stored",
	storageKey: `key/${outboxAttachmentId}`,
	reservationExpiresAt: 0,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

const setup = async (rows: OutboxAttachmentItem[], stored: string[]) => {
	const storage = createMockStorageService();
	for (const outboxAttachmentId of stored) {
		await storage.storeOutboxAttachment({
			...OWNER,
			outboxAttachmentId,
			content: Buffer.from(`bytes of ${outboxAttachmentId}`),
		});
	}
	return {
		attachments: { listByOutboxMessage: async () => rows },
		storage,
	};
};

describe("loadOutboxAttachmentContents", () => {
	it("returns every stored file with its bytes, in the order it was attached", async () => {
		const deps = await setup(
			[row("second", { createdAt: 20 }), row("first", { createdAt: 10 })],
			["first", "second"],
		);

		const contents = await loadOutboxAttachmentContents(deps, OWNER, NOW);

		assert.deepEqual(
			contents.map((item) => [
				item.filename,
				item.contentType,
				item.content.toString(),
			]),
			[
				["first.txt", "text/plain", "bytes of first"],
				["second.txt", "text/plain", "bytes of second"],
			],
		);
	});

	it("leaves out a reservation that lapsed without its bytes", async () => {
		const deps = await setup(
			[
				row("kept"),
				row("lapsed", { state: "Pending", reservationExpiresAt: NOW - 1 }),
			],
			["kept"],
		);

		const contents = await loadOutboxAttachmentContents(deps, OWNER, NOW);

		assert.deepEqual(
			contents.map((item) => item.filename),
			["kept.txt"],
		);
	});

	it("refuses to build a message while an upload is still open", async () => {
		const deps = await setup(
			[row("open", { state: "Pending", reservationExpiresAt: NOW + 60 })],
			[],
		);

		await assert.rejects(
			() => loadOutboxAttachmentContents(deps, OWNER, NOW),
			/attachment open that never finished uploading/,
		);
	});

	it("refuses to build a message whose stored file has no bytes behind it", async () => {
		const deps = await setup([row("gone")], []);

		await assert.rejects(
			() => loadOutboxAttachmentContents(deps, OWNER, NOW),
			/gone is recorded as stored but nothing is stored at key\/gone/,
		);
	});
});
