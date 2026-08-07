import type { OutboxAttachmentItem } from "../types.js";

export interface CreateOutboxAttachmentInput {
	outboxAttachmentId: string;
	outboxMessageId: string;
	accountId: string;
	accountConfigId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	storageKey: string;
	reservationExpiresAt: number;
}

/**
 * The numbers the reservation must fit inside. They come from the caller — the
 * cap is a business rule and belongs with the rest of them — but they are
 * applied here, where the count and the insert can happen together.
 */
export interface OutboxAttachmentCap {
	maxTotalBytes: number;
	maxCount: number;
	/** Unix seconds. A Pending row past its expiry stops holding room. */
	nowSeconds: number;
}

export type ReserveOutboxAttachmentResult =
	| { outcome: "Reserved"; item: OutboxAttachmentItem }
	| { outcome: "OverByteCap"; usedBytes: number }
	| { outcome: "OverCountCap"; usedBytes: number };

export interface IOutboxAttachmentRepository {
	/**
	 * Claim room on a draft, or report why there is none — counting what the
	 * draft already holds and inserting the new row in one transaction.
	 *
	 * This is the whole of the per-message cap. Doing it in the database rather
	 * than around it is what makes it hold when parallel requests land in
	 * separate processes, which is the ordinary case on a deployment that scales
	 * horizontally.
	 */
	reserve(
		input: CreateOutboxAttachmentInput,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult>;

	/** One attachment, scoped to its tenant. Throws NotFound when it is gone. */
	get(
		accountConfigId: string,
		outboxAttachmentId: string,
	): Promise<OutboxAttachmentItem>;

	/**
	 * Everything a draft holds, lapsed reservations included. Callers that care
	 * about what is live filter on state and `reservationExpiresAt`.
	 */
	listByOutboxMessage(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxAttachmentItem[]>;

	/**
	 * Move a reservation to Stored at the size storage actually holds. Returns
	 * null when the row is gone or no longer Pending, so a caller can tell a
	 * lapsed reservation from a confirmed one without a second read.
	 */
	markStored(
		accountConfigId: string,
		outboxAttachmentId: string,
		sizeBytes: number,
	): Promise<OutboxAttachmentItem | null>;

	/** Drop specific attachments from a draft. */
	deleteMany(
		accountConfigId: string,
		outboxAttachmentIds: string[],
	): Promise<void>;

	/** Drop everything a draft holds, as part of retiring the draft. */
	deleteByOutboxMessage(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<void>;
}
