import type { OutboxAttachmentItem } from "../types.js";

/**
 * Whether an attachment is spoken for: uploaded and confirmed, or reserved and
 * not yet lapsed. The cap counts these and nothing else. One definition, because
 * the repository and the service both have to agree on it exactly.
 */
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
	 * Claim room on a draft, or report why there is none.
	 *
	 * **The invariant an implementation owes its callers:** of two reservations
	 * for the same draft running concurrently, at most one may observe a total
	 * that does not include the other. Either one of them sees the other's row,
	 * or one of them fails. Both being told there was room is a breach, and the
	 * consequence is a message that cannot be sent — phase 4 builds a MIME body
	 * from these rows and the receiving server rejects it.
	 *
	 * A count-then-insert only satisfies that under serializable isolation or an
	 * external lock. **The drizzle/SQLite implementation gets it from neither the
	 * schema nor the isolation level:** `runInTransaction` issues a SAVEPOINT,
	 * which begins a DEFERRED transaction, and what actually orders concurrent
	 * reservations is the module-level write queue in `tx.ts` — correct on a
	 * single-process deployment, which is what that backend is. Two writer
	 * processes against one SQLite file would fail loud
	 * (`SQLITE_BUSY_SNAPSHOT`), not silently over-admit.
	 *
	 * **An adapter without serializable isolation must not do a
	 * read-then-write.** On DynamoDB in particular, a Query followed by a
	 * PutItem breaches this silently and is the failure mode that matters: it is
	 * the deployment that actually scales horizontally. Use a conditional write
	 * on a per-draft aggregate instead — an `UpdateItem` that adds the size and
	 * carries a `ConditionExpression` bounding the running total, decided on
	 * whether the condition held — and derive `usedBytes` for the rejection from
	 * the same item.
	 *
	 * Either way the caller supplies the limits: the cap is a business rule and
	 * lives with the rest of them. What is delegated here is only the atomicity.
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

	/**
	 * Drop the draft's reservations that lapsed without ever being confirmed, and
	 * report which ids went.
	 *
	 * A `Pending` row past its expiry already stops holding room, but until it is
	 * gone it still names an object — which is enough for the sweep to treat that
	 * object as accounted for and leave it. So the row has to go, and the sweep
	 * collects the bytes on the same pass. `complete` refuses a lapsed row, so
	 * nothing is racing this.
	 */
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
