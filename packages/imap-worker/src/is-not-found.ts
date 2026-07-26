/**
 * A repository lookup or write for a row that no longer exists rejects with a
 * `NotFoundError` (name-matched, since the class crosses the data-ports adapter
 * boundary — see `@remit/data-ports/errors`).
 *
 * A worker event that references a deliberately-deleted mailbox is completed or
 * moot work, never a transient fault: every redelivery re-throws the same
 * `NotFoundError`, and because the sync queues carry `MessageGroupId=accountId`
 * that permanently-failing head message stalls the whole account's per-group
 * FIFO. Handlers use this predicate to resolve such an event terminally (ack
 * with a WARN) instead of retrying forever (issues #287, #289, #290).
 *
 * The guard is narrow on purpose: only a genuine not-found terminates. Real
 * IMAP/infra failures carry other errors and must still propagate to be retried.
 */
export const isNotFoundError = (error: unknown): boolean =>
	(error as { name?: string })?.name === "NotFoundError";
