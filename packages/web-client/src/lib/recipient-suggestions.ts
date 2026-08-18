import type { RemitImapAddressFlags } from "@remit/api-http-client";

/**
 * Whether the compose picker may offer a sender. The address search that feeds
 * it also feeds the Senders settings screen, which has to show a sender the
 * account blocked or muted; being findable there says nothing about being a
 * recipient here. A sender met only in Junk was never chosen, and a blocked one
 * was chosen against.
 */
export const offerableAsRecipient = (
	flags: RemitImapAddressFlags | undefined,
): boolean => flags?.junkOnly?.value !== true && flags?.blocked?.value !== true;
