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
 * defers every outbound mutation in the product. `status` is set to `moving`
 * only by an actual move and cleared only once that move settles.
 */
export const isPlacementUnsettled = (
	message: Pick<MessageItem, "status">,
): boolean => message.status === MessageStatus.moving;

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
