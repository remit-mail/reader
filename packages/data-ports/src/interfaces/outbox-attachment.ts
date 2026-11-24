import type { OutboxAttachmentItem } from "../types.js";

/** Whether an attachment holds room: Stored or reserved and not yet expired. */
export const holdsRoom = (
	item: OutboxAttachmentItem,
	nowSeconds: number,
): boolean =>
	item.state === "Stored" || item.reservationExpiresAt >= nowSeconds;

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

/** Caller-supplied limits enforced atomically by the repository. */
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
	/** Atomically claim room on a draft under the supplied caps, counting rows that satisfy holdsRoom. */
	reserve(
		input: CreateOutboxAttachmentInput,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult>;

	/** Atomically renew an existing Pending row under the same caps. Never recreates a row deleted by cleanup. */
	renew(
		input: Pick<
			CreateOutboxAttachmentInput,
			| "accountConfigId"
			| "outboxMessageId"
			| "outboxAttachmentId"
			| "reservationExpiresAt"
		>,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult | { outcome: "Missing" }>;

	/** One attachment, scoped to its tenant. Throws NotFound when it is gone. */
	get(
		accountConfigId: string,
		outboxAttachmentId: string,
	): Promise<OutboxAttachmentItem>;

	/** Everything a draft holds, including lapsed reservations. */
	listByOutboxMessage(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxAttachmentItem[]>;

	/** Atomically mark a Pending row Stored at its actual size under the caps; return null if missing, not Pending, or over cap. */
	markStored(
		accountConfigId: string,
		outboxAttachmentId: string,
		sizeBytes: number,
		cap: OutboxAttachmentCap,
	): Promise<OutboxAttachmentItem | null>;

	/** Drop specific attachments from a draft. */
	deleteMany(
		accountConfigId: string,
		outboxAttachmentIds: string[],
	): Promise<void>;

	/** Delete the draft's expired Pending rows and return their ids. */
	deleteLapsedReservations(
		accountConfigId: string,
		outboxMessageId: string,
		nowSeconds: number,
	): Promise<string[]>;

	/** Drop everything a draft holds, as part of retiring the draft. */
	deleteByOutboxMessage(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<void>;
}
