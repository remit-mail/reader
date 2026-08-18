import type { RemitImapAddressResponse } from "@remit/api-http-client";

/**
 * What the account has done with a sender, or said in its favour — the same
 * four facts `addressListable` reads in SQL. The two must agree: nothing clears
 * the junk-only mark when a counter is incremented or a VIP is named, so a
 * client that read the mark alone would keep refusing a sender the server had
 * already restored, until the next restart.
 */
const accountHasCorresponded = (address: RemitImapAddressResponse): boolean =>
	address.outboundCount > 0 ||
	address.replyCount > 0 ||
	address.flags?.vip?.value === true ||
	address.flags?.trusted?.value === true;

/**
 * Whether the compose picker may offer a sender. The address search that feeds
 * it also feeds the Senders settings screen, which has to show a sender the
 * account blocked; being findable there says nothing about being a recipient
 * here. A mute is about notice rather than mail, and still offers.
 */
export const offerableAsRecipient = (
	address: RemitImapAddressResponse,
): boolean => {
	if (address.flags?.blocked?.value === true) return false;
	if (address.flags?.junkOnly?.value !== true) return true;
	return accountHasCorresponded(address);
};
