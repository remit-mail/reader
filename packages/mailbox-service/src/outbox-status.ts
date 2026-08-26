import type { OutboxMessageItem } from "@remit/data-ports";
import { OutboxMessageStatus } from "@remit/domain-enums";

/**
 * Whether the message is still the user's to work on: nothing of it is on the
 * wire, so Send, Edit and its attachments all apply.
 *
 * One predicate for all three because they answer the same question, and
 * splitting them is what dead-ended a refused message. Sending took `failed`
 * while editing took only `draft`, so a message the server turned away for a
 * bad address could be re-sent unchanged or deleted, and nothing else — Retry
 * queued the same envelope, and Edit took a 409 on the flush that precedes the
 * send (#933).
 *
 * Everything absent is in the worker's hands or settled: `queued` and `sending`
 * are mid-flight, `sent` and `unfiled` were delivered.
 */
export const isOpenForWork = (status: OutboxMessageItem["status"]): boolean =>
	status === OutboxMessageStatus.draft ||
	status === OutboxMessageStatus.failed ||
	status === OutboxMessageStatus.blocked;
