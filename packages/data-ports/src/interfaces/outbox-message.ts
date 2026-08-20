import type {
	CreateOutboxMessageInput,
	OutboxMessageItem,
	ResultList,
	UpdateOutboxMessageInput,
} from "../types.js";

/** `appendedUid` when no IMAP APPEND has been confirmed for the row. */
export const APPENDED_UID_NONE = 0;

/**
 * `appendedUid` when an APPEND was confirmed but the server named no uid for
 * it. UIDPLUS is an extension; a server without it files the copy and reports
 * nothing, and "filed" still has to be distinguishable from "not filed".
 */
export const APPENDED_UID_UNREPORTED = -1;

/**
 * Whether the copy in Sent exists. One definition, because the handler deciding
 * whether to APPEND and the repair deciding what a stranded row means both have
 * to agree on it exactly.
 *
 * Only the two values that mean "filed" say so, rather than everything that is
 * not `APPENDED_UID_NONE`. The two mistakes are not each other's equal: reading
 * a filed row as unfiled files a second copy the user then deletes, and reading
 * an unfiled row as filed drops the row of a delivered message that is in no
 * folder — the disappearance the whole repair exists to prevent (#824).
 */
export const isSentCopyFiled = (
	message: Pick<OutboxMessageItem, "appendedUid">,
): boolean =>
	message.appendedUid > 0 || message.appendedUid === APPENDED_UID_UNREPORTED;

export interface IOutboxMessageRepository {
	create(input: CreateOutboxMessageInput): Promise<OutboxMessageItem>;
	/**
	 * `mode: "read"` (default) throws NotFoundError on a foreign message so a
	 * GET doesn't leak existence. `mode: "act"` throws ForbiddenError instead,
	 * for action verbs (PATCH/POST/DELETE) where the caller has already named
	 * the resource and the API contract says to explicitly deny rather than
	 * feign 404 — see assertAccountOwnership / assertMessagesOwned.
	 */
	get(
		accountConfigId: string,
		outboxMessageId: string,
		mode?: "read" | "act",
	): Promise<OutboxMessageItem>;
	get(
		accountConfigId: string,
		outboxMessageIds: string[],
	): Promise<OutboxMessageItem[]>;
	update(
		accountConfigId: string,
		outboxMessageId: string,
		input: UpdateOutboxMessageInput,
	): Promise<OutboxMessageItem>;
	updateStatus(
		accountConfigId: string,
		outboxMessageId: string,
		status: OutboxMessageItem["status"],
	): Promise<OutboxMessageItem>;
	markSent(
		accountConfigId: string,
		outboxMessageId: string,
		fields: { sentAt: number; smtpMessageId?: string },
	): Promise<OutboxMessageItem>;
	delete(accountConfigId: string, outboxMessageId: string): Promise<void>;
	deleteMany(
		accountConfigId: string,
		outboxMessageIds: string[],
	): Promise<void>;
	listByAccount(
		accountId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<OutboxMessageItem>>;
	listQueued(accountId: string): Promise<OutboxMessageItem[]>;
}
