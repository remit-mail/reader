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
 * `unfiled` may have been delivered, so it is open only to a deliberate edit
 * and send; nothing re-sends it on its own. `queued` and `sending` are
 * mid-flight and `sent` was delivered.
 */
export const isOpenForWork = (status: OutboxMessageItem["status"]): boolean =>
	status === OutboxMessageStatus.draft ||
	status === OutboxMessageStatus.failed ||
	status === OutboxMessageStatus.blocked ||
	status === OutboxMessageStatus.unfiled;
