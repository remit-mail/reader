import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { MessageItem } from "./types.js";

export type MessageSettlementFields = Pick<
	MessageItem,
	"status" | "syncStatus"
>;

/**
 * A delete Remit refused to run, having already removed the message locally.
 * `abandonDelete` reaches this from four checks, all of them made before any
 * expunge: the Trash folder the event names is not on the server (TRYCREATE),
 * the event carries no destination, it names an operation this build does not
 * recognise, or it was minted under an unknown contract. The row is handed back
 * to the folder the server still holds the message in, and only then marked.
 *
 * `status: active` alongside `syncStatus: abandoned` is the whole signal, and
 * `abandonDelete` (`imap-worker/src/handlers/message-delete.ts`) is its only
 * writer. `abandoned` is the give-up value of the placement state model
 * (docs/architecture/imap-mutations.md R3) and it is unambiguous by
 * construction: a transient attempt writes `failed` and re-throws for
 * redelivery, so `failed` never reaches here, and a mutation that exhausted its
 * retries is repaired against IMAP to `active` + `synced` and reads as settled.
 *
 * One give-up this cannot see, and must not pretend to: `flag-push` and
 * `placement-move-push` never write either field. Their give-up state lives on
 * their own marker rows and in the operator alert.
 */
export const hasAbandonedDelete = (message: MessageSettlementFields): boolean =>
	message.status === MessageStatus.active &&
	message.syncStatus === MessageSyncStatus.abandoned;
