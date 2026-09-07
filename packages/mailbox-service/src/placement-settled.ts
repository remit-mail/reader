import type { MessageItem } from "@remit/data-ports";
import { MessageStatus } from "@remit/domain-enums";

/**
 * Whether the message row's placement is still an unconfirmed local write
 * (issue #496). While a move is in flight the row carries the destination in
 * `mailboxId` but the SOURCE folder's `uid` — the pair is only made consistent
 * when the IMAP move confirms and `updateUid` writes the destination's COPYUID.
 * Any dependent mutation that resolves a folder and a uid from such a row
 * therefore addresses the destination's OWN message at that uid: a different
 * message, on a mailbox Remit is never the only client of.
 *
 * `syncStatus` is not the signal. An ordinary freshly-synced inbound row is
 * `pending` forever (nothing on the inbound path promotes it), so keying off it
 * defers every outbound mutation in the product. `status` is what an actual
 * mutation writes and what settling clears.
 *
 * Both in-flight states count, per the R3 state table: a delete points the row
 * at Trash with the source's uid exactly as a move points it at the
 * destination, so a dependent mutation that reads a `deleting` row resolves the
 * same mismatched pair. Reading `moving` alone let a move enqueued behind a
 * delete bind to the row mid-delete and be dropped when the delete settled.
 */
export const isPlacementUnsettled = (
	message: Pick<MessageItem, "status">,
): boolean =>
	message.status === MessageStatus.moving ||
	message.status === MessageStatus.deleting;

/**
 * Whether the row's `uid` belongs to a folder other than the one `mailboxId`
 * names — the state that makes the pair a lie rather than merely incomplete.
 *
 * The optimistic half of a move is the only writer of this shape: it points the row at the
 * destination and records the pre-move pair, leaving `uid` untouched until the
 * server confirms and `updateUid` replaces it. A row with no `originalUid` was
 * never moved, so its uid names nothing but itself — a freshly copied row is
 * `moving` with `uid: 0` until COPYUID lands, which is a uid that is not ready,
 * not a uid that names somebody else's message.
 *
 * Answered without reference to `status`, because `status` is not what clears
 * it: `updateUid` does, dropping `originalUid` in the same statement that
 * writes the destination's own, and a restore does by pointing `mailboxId`
 * back at `originalMailboxId`. An operation that rewrites `status` on its way
 * past — Empty Trash marking a whole folder `deleting` — leaves the pair
 * untouched, so anything that resolves a uid off a row it did not settle
 * itself asks this rather than the binding below (issue #1217).
 */
export const carriesForeignUid = (
	message: Pick<
		MessageItem,
		"mailboxId" | "uid" | "originalMailboxId" | "originalUid"
	>,
): boolean =>
	message.originalUid !== undefined &&
	message.originalUid === message.uid &&
	message.originalMailboxId !== undefined &&
	message.originalMailboxId !== message.mailboxId;

export const bindsForeignUid = (
	message: Pick<
		MessageItem,
		"status" | "mailboxId" | "uid" | "originalMailboxId" | "originalUid"
	>,
): boolean => isPlacementUnsettled(message) && carriesForeignUid(message);

/**
 * `in_flight` — a mutation is still working on the row, so waiting resolves it.
 * That includes a row mid-retry: `message-move`, `message-delete` and
 * `message-copy` write `syncStatus: failed` on an ordinary transient attempt
 * and re-throw for redelivery, so a failed attempt is a mutation about to
 * succeed and the settle ceiling is exactly what it is for (imap-mutations R3).
 *
 * There is no give-up member, because a give-up cannot reach here: `abandoned`
 * is written only alongside `status: active` (a hand-back) or `deleted` (a copy
 * that never existed), and the row it leaves names a placement the server
 * confirmed — so it binds `consistent` and no dependent mutation is refused on
 * account of it. A mutation that exhausts its budget settles the row against
 * IMAP rather than leaving a mismatched pair behind (#1005).
 */
export type PlacementBinding = "consistent" | "in_flight";

export const placementBindingOf = (
	message: Pick<
		MessageItem,
		"status" | "mailboxId" | "uid" | "originalMailboxId" | "originalUid"
	>,
): PlacementBinding => (bindsForeignUid(message) ? "in_flight" : "consistent");

export interface PlacementSettleOptions {
	timeoutMs: number;
	pollMs: number;
}

/**
 * Block a dependent mutation until the row's placement settles, then hand back
 * the confirmed row — the wait half of docs/architecture/imap-mutations.md R2.
 * A move ordinarily settles in well under a second, so blocking is the cheap
 * option the doc's default guidance names. The row comes back still unsettled
 * when the deadline passes; the caller decides what a dependency that never
 * settled means for it.
 */
export const waitForPlacementToSettle = async (
	messageService: { get(messageId: string): Promise<MessageItem> },
	messageId: string,
	{ timeoutMs, pollMs }: PlacementSettleOptions,
): Promise<MessageItem> => {
	const deadline = Date.now() + timeoutMs;
	let message = await messageService.get(messageId);
	while (isPlacementUnsettled(message) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, pollMs));
		message = await messageService.get(messageId);
	}
	return message;
};
