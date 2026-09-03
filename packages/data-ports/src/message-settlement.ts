import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { MessageItem } from "./types.js";

export type MessageSettlementFields = Pick<
	MessageItem,
	"status" | "syncStatus"
>;

/**
 * A delete that gave up: the mail server never accepted it, the mutator stopped
 * trying, and the row was handed back to the folder it was deleted from.
 *
 * `status: active` alongside `syncStatus: failed` is the whole signal, and it is
 * reachable only from a terminal give-up. Every other writer of one of the two
 * values writes the other along with it:
 *
 * - `updateUid` (`drizzle-service/src/repos/message.ts`) settles a confirmed
 *   move by writing `active` and `synced` in the same statement, so a move that
 *   worked after a failed attempt cannot leave `failed` behind.
 * - `empty-trash` hands a marked row back as `active` + `synced`.
 * - `abandonDelete` (`imap-worker/src/handlers/message-delete.ts`) and
 *   `resolveExhaustedMessageDeleteFailure` (…/message-delete-terminal.ts) write
 *   `active` + `failed` together. They are the only two.
 * - `upsertWithStatus` leaves an existing row alone, so no inbound sync writes
 *   either value onto a row that already has them.
 *
 * `syncStatus: failed` ON ITS OWN is NOT a give-up marker, whatever
 * `placement-settled.ts`'s docstring says. `message-move.ts`, `message-delete.ts`
 * and `message-copy.ts` each write it on an ORDINARY TRANSIENT attempt and then
 * re-throw for queue redelivery — the row is mid-retry and about to succeed. In
 * those handlers `status` stays at its in-flight value (`moving`, `deleting`),
 * which is what separates them from the pair above.
 *
 * Two consequences no caller may forget:
 *
 * - A MOVE that gave up is NOT derivable. Its terminal outcome leaves
 *   `moving` + `failed`, the same pair a first dropped connection writes, and
 *   nothing persisted tells the two apart.
 * - `flag-push` and `placement-move-push` never write either field at all.
 *   Their give-up state lives on their own marker rows and is invisible here.
 */
export const hasAbandonedDelete = (message: MessageSettlementFields): boolean =>
	message.status === MessageStatus.active &&
	message.syncStatus === MessageSyncStatus.failed;
