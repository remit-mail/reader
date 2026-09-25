import type { IOutboxAttachmentRepository } from "@remit/data-ports";
import { holdsRoom } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";

export interface OutboxAttachmentContent {
	filename: string;
	contentType: string;
	content: Buffer;
}

export interface OutboxAttachmentContentDeps {
	attachments: Pick<IOutboxAttachmentRepository, "listByOutboxMessage">;
	storage: Pick<StorageService, "retrieveOutboxAttachment">;
}

export interface OutboxAttachmentOwner {
	accountConfigId: string;
	accountId: string;
	outboxMessageId: string;
}

/**
 * Every file a message goes out with, bytes included, in the order they were
 * attached. The send op refuses a draft with an upload still open, so a live
 * `Pending` row here, or a `Stored` row with nothing behind it, is a message
 * that cannot be built as the sender saw it — and sending it without the file
 * would be worse than not sending it.
 */
export const loadOutboxAttachmentContents = async (
	deps: OutboxAttachmentContentDeps,
	owner: OutboxAttachmentOwner,
	nowSeconds: number,
): Promise<OutboxAttachmentContent[]> => {
	const held = await deps.attachments.listByOutboxMessage(
		owner.accountConfigId,
		owner.outboxMessageId,
	);
	const live = held
		.filter((item) => holdsRoom(item, nowSeconds))
		.sort((a, b) => a.createdAt - b.createdAt);

	const unfinished = live.find((item) => item.state !== "Stored");
	if (unfinished) {
		throw new Error(
			`Outbox message ${owner.outboxMessageId} carries attachment ${unfinished.outboxAttachmentId} that never finished uploading`,
		);
	}

	return Promise.all(
		live.map(async (item) => {
			const content = await deps.storage.retrieveOutboxAttachment(
				owner.accountConfigId,
				owner.accountId,
				owner.outboxMessageId,
				item.outboxAttachmentId,
			);
			if (content === null) {
				throw new Error(
					`Outbox attachment ${item.outboxAttachmentId} is recorded as stored but nothing is stored at ${item.storageKey}`,
				);
			}
			return {
				filename: item.filename,
				contentType: item.contentType,
				content,
			};
		}),
	);
};
