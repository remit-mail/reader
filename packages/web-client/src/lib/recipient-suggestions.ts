import type { RemitImapAddressResponse } from "@remit/api-http-client";

const accountHasCorresponded = (address: RemitImapAddressResponse): boolean =>
	address.outboundCount > 0 ||
	address.replyCount > 0 ||
	address.flags?.vip?.value === true ||
	address.flags?.trusted?.value === true;

export const offerableAsRecipient = (
	address: RemitImapAddressResponse,
): boolean => {
	if (address.flags?.blocked?.value === true) return false;
	if (address.flags?.junkOnly?.value !== true) return true;
	return accountHasCorresponded(address);
};
