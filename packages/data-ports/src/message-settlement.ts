import { MessageMutation, MessageSyncStatus } from "@remit/domain-enums";
import type { MessageItem } from "./types.js";

export type MessageSettlementFields = Pick<
	MessageItem,
	"status" | "syncStatus" | "abandonedMutation"
>;

/**
 * Which mutation gave up on this row, and `none` where none did.
 *
 * `syncStatus: abandoned` is the gate and the only gate: it is the give-up
 * value of the placement state model (docs/architecture/imap-mutations.md R3),
 * written only after the row has been put back on a placement the mail server
 * confirmed. Every settle overwrites it, and the settle in `updateUid` clears
 * `abandonedMutation` alongside it. A transient attempt writes
 * `failed` and re-throws for redelivery, so `failed` never reaches here.
 *
 * `abandonedMutation` behind that gate says WHICH mutation, which the row
 * otherwise cannot say: the hand-back sets `status` back to `active`, and
 * `status` was the field naming the mutation that was outstanding. Reading the
 * pair without it is how a move that handed back came to be reported to the
 * user as a failed delete, under a "Delete again" button (issue #1229).
 *
 * Outside the gate the field is `none` and says nothing, exactly as
 * `originalUid` says nothing once a placement has settled. Reading it
 * unconditionally would resurrect a give-up a later mutation has settled.
 *
 * Two give-ups this deliberately does not name. `flag-push` never writes a
 * placement at all — its give-up lives on its own marker row and in an
 * operator alert. `placement-move-push` does restore the row when its push is
 * exhausted, and drops its marker with it, but leaves this field at `none`:
 * Remit's own classification move is not a mutation the user asked for, so a
 * per-message treatment for it would report a failure against an intent nobody
 * formed.
 */
export const abandonedMutationOf = (
	message: MessageSettlementFields,
): MessageItem["abandonedMutation"] =>
	message.syncStatus === MessageSyncStatus.abandoned
		? message.abandonedMutation
		: MessageMutation.none;

/** A delete Remit refused to run or gave up on, having removed it locally first. */
export const hasAbandonedDelete = (message: MessageSettlementFields): boolean =>
	abandonedMutationOf(message) === MessageMutation.delete;

/** A move Remit gave up on, having already pointed the row at the destination. */
export const hasAbandonedMove = (message: MessageSettlementFields): boolean =>
	abandonedMutationOf(message) === MessageMutation.move;
