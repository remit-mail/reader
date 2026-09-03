import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { MessageItem } from "./types.js";

/**
 * What a message row's two mutation fields say about the last IMAP mutation
 * applied to it — the local half of the mutator pattern
 * (docs/architecture/imap-mutations.md R1), read back.
 *
 * - `settled` — nothing is outstanding. The row is what the mail server holds.
 * - `in_flight` — a move or a delete is still being pushed, so the row's folder
 *   is a local write the server has not confirmed yet.
 * - `abandoned` — the mutator gave up. Nothing routine settles such a row:
 *   `repointsOnSighting` refuses to repair it on the next sync sighting, and
 *   `placementBindingOf` refuses to bind a dependent mutation to it. What the
 *   client shows for this message is a local write that never reached the mail
 *   server.
 */
export type MessageSettlement = "settled" | "in_flight" | "abandoned";

export type MessageSettlementFields = Pick<
	MessageItem,
	"status" | "syncStatus"
>;

/**
 * `failed` is the give-up marker, and only that. Every IMAP mutator writes it
 * when it stops trying — `message-move`, `message-copy` and `message-delete`
 * directly, `placement-move-push` by leaving the row it moved locally where it
 * stands — and nothing on the inbound path clears it.
 */
export const hasAbandonedMutation = (
	message: Pick<MessageSettlementFields, "syncStatus">,
): boolean => message.syncStatus === MessageSyncStatus.failed;

/**
 * `status` names an outstanding mutation, `syncStatus` does not: an ordinary
 * inbound row is written `pending` and nothing later promotes it, so `pending`
 * says nothing about whether a mutation is owed (#1096).
 */
export const hasMutationInFlight = (
	message: Pick<MessageSettlementFields, "status">,
): boolean => message.status !== MessageStatus.active;

export const messageSettlementOf = (
	message: MessageSettlementFields,
): MessageSettlement => {
	if (hasAbandonedMutation(message)) return "abandoned";
	if (hasMutationInFlight(message)) return "in_flight";
	return "settled";
};
