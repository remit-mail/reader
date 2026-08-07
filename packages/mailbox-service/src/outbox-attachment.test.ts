import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IOutboxMessageRepository,
	OutboxMessageItem,
} from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import {
	OutboxAttachmentRejectionReason,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import {
	createMockStorageService,
	type StorageService,
} from "@remit/storage-service";
import {
	OUTBOX_ATTACHMENT_MAX_COUNT,
	OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
	OutboxAttachmentService,
} from "./outbox-attachment.js";

const ACCOUNT_CONFIG_ID = "cfg-679";
const ACCOUNT_ID = "acc-679";
const DRAFT_ID = "draft-679";

const build = (
	status: OutboxMessageItem["status"] = OutboxMessageStatus.draft,
): { service: OutboxAttachmentService; storage: StorageService } => {
	const storage = createMockStorageService();
	const outboxMessageService = {
		get: async (
			accountConfigId: string,
			_id: string,
			mode?: "read" | "act",
		) => {
			if (accountConfigId !== ACCOUNT_CONFIG_ID) {
				assert.equal(mode, "act");
				throw new ForbiddenError("not yours");
			}
			return {
				outboxMessageId: DRAFT_ID,
				accountId: ACCOUNT_ID,
				accountConfigId,
				status,
			} as OutboxMessageItem;
		},
	} as unknown as IOutboxMessageRepository;

	return {
		service: new OutboxAttachmentService({ outboxMessageService, storage }),
		storage,
	};
};

const upload = (
	service: OutboxAttachmentService,
	overrides: Partial<{
		accountConfigId: string;
		filename: string;
		contentType: string;
		content: Buffer;
	}> = {},
) =>
	service.store({
		accountConfigId: ACCOUNT_CONFIG_ID,
		outboxMessageId: DRAFT_ID,
		filename: "notes.txt",
		contentType: "text/plain",
		content: Buffer.from("some bytes"),
		...overrides,
	});

const fill = async (
	storage: StorageService,
	count: number,
	sizeBytes: number,
): Promise<void> => {
	for (let index = 0; index < count; index += 1) {
		await storage.storeOutboxAttachment({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			outboxMessageId: DRAFT_ID,
			outboxAttachmentId: `existing-${index}`,
			content: Buffer.alloc(sizeBytes),
		});
	}
};

describe("OutboxAttachmentService", () => {
	it("stores the file and describes what was stored", async () => {
		const { service, storage } = build();

		const result = await upload(service, {
			filename: "invoice.pdf",
			contentType: "application/pdf",
			content: Buffer.from("%PDF-1.7"),
		});

		assert.equal(result.outcome, "Stored");
		if (result.outcome !== "Stored") return;
		assert.equal(result.attachment.filename, "invoice.pdf");
		assert.equal(result.attachment.contentType, "application/pdf");
		assert.equal(result.attachment.sizeBytes, 8);
		assert.equal(result.attachment.outboxMessageId, DRAFT_ID);

		const stored = await storage.listOutboxAttachments(
			ACCOUNT_CONFIG_ID,
			ACCOUNT_ID,
			DRAFT_ID,
			10,
		);
		assert.deepEqual(
			stored.map((item) => item.outboxAttachmentId),
			[result.attachment.outboxAttachmentId],
		);
	});

	it("refuses a file over the cap and reports what the draft already holds", async () => {
		const { service, storage } = build();
		await fill(storage, 1, 1024);

		const result = await upload(service, {
			filename: "huge.bin",
			content: Buffer.alloc(OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES + 1),
		});

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.FileTooLarge,
		);
		assert.equal(result.rejection.usedBytes, 1024);
		assert.equal(
			result.rejection.limitBytes,
			OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES,
		);
	});

	it("refuses a file that only overflows once the draft's own files are counted", async () => {
		const { service, storage } = build();
		await fill(storage, 1, OUTBOX_ATTACHMENT_MAX_TOTAL_BYTES - 100);

		const result = await upload(service, { content: Buffer.alloc(200) });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.MessageTooLarge,
		);
	});

	it("refuses a file once the draft holds the most files a message can", async () => {
		const { service, storage } = build();
		await fill(storage, OUTBOX_ATTACHMENT_MAX_COUNT, 1);

		const result = await upload(service);

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.TooManyAttachments,
		);
	});

	it("refuses an empty file", async () => {
		const { service } = build();

		const result = await upload(service, { content: Buffer.alloc(0) });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.EmptyFile,
		);
	});

	it("refuses a filename that sanitizes to nothing", async () => {
		const { service } = build();

		const result = await upload(service, { filename: "../.." });

		assert.equal(result.outcome, "Rejected");
		if (result.outcome !== "Rejected") return;
		assert.equal(
			result.rejection.reason,
			OutboxAttachmentRejectionReason.UnusableFilename,
		);
	});

	it("records a filename stripped of its path and a media type it cannot read", async () => {
		const { service } = build();

		const result = await upload(service, {
			filename: "../../etc/passwd",
			contentType: "",
		});

		assert.equal(result.outcome, "Stored");
		if (result.outcome !== "Stored") return;
		assert.equal(result.attachment.filename, "passwd");
		assert.equal(result.attachment.contentType, "application/octet-stream");
	});

	it("denies an upload against a draft owned by someone else", async () => {
		const { service, storage } = build();

		await assert.rejects(
			() => upload(service, { accountConfigId: "cfg-stranger" }),
			ForbiddenError,
		);
		assert.deepEqual(
			await storage.listOutboxAttachments(
				ACCOUNT_CONFIG_ID,
				ACCOUNT_ID,
				DRAFT_ID,
				10,
			),
			[],
		);
	});

	it("refuses to attach to a message that has left draft", async () => {
		const { service } = build(OutboxMessageStatus.queued);

		await assert.rejects(() => upload(service), {
			name: "ConflictError",
			message: /no longer take an attachment/,
		});
	});
});
