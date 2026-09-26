import type { IOutboxAttachmentRepository } from "@remit/data-ports";
import { holdsRoom } from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";

export interface OutboxAttachmentContent {
	filename: string;
	contentType: string;
	content: Buffer;
}

/**
 * A file on a message that cannot be put into it. Carries the file's name so
 * whoever settles the message can tell the sender which file to fix.
 */
export class OutboxAttachmentUnavailableError extends Error {
	constructor(
		readonly filename: string,
		readonly detail: string,
		options?: { cause: unknown },
	) {
		super(`"${filename}" could not be read: ${detail}`, options);
		this.name = "OutboxAttachmentUnavailableError";
	}
}

const describeCause = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

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
		throw new OutboxAttachmentUnavailableError(
			unfinished.filename,
			`attachment ${unfinished.outboxAttachmentId} never finished uploading`,
		);
	}

	return Promise.all(
		live.map(async (item) => {
			const content = await Promise.resolve()
				.then(() =>
					deps.storage.retrieveOutboxAttachment(
						owner.accountConfigId,
						owner.accountId,
						owner.outboxMessageId,
						item.outboxAttachmentId,
					),
				)
				.catch((error: unknown) => {
					throw new OutboxAttachmentUnavailableError(
						item.filename,
						`storage failed (${describeCause(error)})`,
						{ cause: error },
					);
				});
			if (content === null) {
				throw new OutboxAttachmentUnavailableError(
					item.filename,
					`nothing is stored at ${item.storageKey}`,
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
