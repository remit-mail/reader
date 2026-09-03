import { hasAbandonedMutation, type MessageItem } from "@remit/data-ports";
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
 * defers every outbound mutation in the product. `status` is set to `moving`
 * only by an actual move and cleared only once that move settles.
 */
export const isPlacementUnsettled = (
	message: Pick<MessageItem, "status">,
): boolean => message.status === MessageStatus.moving;

/**
 * Whether the row's `uid` belongs to a folder other than the one `mailboxId`
 * names — the state that makes the pair a lie rather than merely incomplete.
 *
 * `updateForMove` is the only writer of this shape: it points the row at the
 * destination and records the pre-move pair, leaving `uid` untouched until the
 * server confirms and `updateUid` replaces it. A row with no `originalUid` was
 * never moved, so its uid names nothing but itself — a freshly copied row is
 * `moving` with `uid: 0` until COPYUID lands, which is a uid that is not ready,
 * not a uid that names somebody else's message.
 */
export const bindsForeignUid = (
	message: Pick<
		MessageItem,
		"status" | "mailboxId" | "uid" | "originalMailboxId" | "originalUid"
	>,
): boolean =>
	isPlacementUnsettled(message) &&
	message.originalUid !== undefined &&
	message.originalUid === message.uid &&
	message.originalMailboxId !== undefined &&
	message.originalMailboxId !== message.mailboxId;

/**
 * `in_flight` — a mover is still working on the row, so waiting resolves it.
 * `abandoned` — the mover gave up without confirming (`syncStatus: failed`,
 * written by every handler's give-up path while `status` stays `moving`, since
 * only `updateUid` clears it). Nothing routine settles such a row, so waiting
 * on one is a wait that never ends, and the pair stays a lie either way.
 */
export type PlacementBinding = "consistent" | "in_flight" | "abandoned";

export const placementBindingOf = (
	message: Pick<
		MessageItem,
		| "status"
		| "syncStatus"
		| "mailboxId"
		| "uid"
		| "originalMailboxId"
		| "originalUid"
	>,
): PlacementBinding => {
	if (!bindsForeignUid(message)) return "consistent";
	return hasAbandonedMutation(message) ? "abandoned" : "in_flight";
};

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
