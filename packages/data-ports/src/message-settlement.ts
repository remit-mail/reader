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
 * to the folder the server still holds the message in.
 *
 * `status: active` alongside `syncStatus: failed` is the whole signal, and
 * `abandonDelete` (`imap-worker/src/handlers/message-delete.ts`) is its ONLY
 * writer. Every other writer of either value writes the other along with it:
 *
 * - `updateUid` (`drizzle-service/src/repos/message.ts`) settles a confirmed
 *   move by writing `active` and `synced` in the same statement, so a move that
 *   worked after a failed attempt cannot leave `failed` behind.
 * - `empty-trash` and `message-copy`'s `settleCopied` both hand a row back as
 *   `active` + `synced`.
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
 * Three give-ups this cannot see, and must not pretend to:
 *
 * - A MOVE that gave up leaves `moving` + `failed`, the same pair a first
 *   dropped connection writes. Nothing persisted tells the two apart.
 * - A DELETE that exhausted its retries settles `active` + `synced` (#1143's
 *   `resolveExhaustedMessageDeleteFailure` repairs the row to where the message
 *   actually is), so it reads as fully settled here.
 * - `flag-push` and `placement-move-push` never write either field at all.
 *   Their give-up state lives on their own marker rows.
 */
export const hasAbandonedDelete = (message: MessageSettlementFields): boolean =>
	message.status === MessageStatus.active &&
	message.syncStatus === MessageSyncStatus.failed;
