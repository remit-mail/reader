import type { VipSuggestionEntry } from "@remit/api-openapi-types";
import type { AddressItem } from "@remit/remit-electrodb-service";

/**
 * Map an Address row to the wire-format `VipSuggestionEntry` returned by
 * `GET /me/vip-suggestions` (issue #234). Absent counters are normalised to
 * zero so the UI can render `12 received · 4 sent · 2 replies` without a
 * `?? 0` fallback at every render site.
 */
export const toVipSuggestionEntry = (
	item: AddressItem,
): VipSuggestionEntry => ({
	addressId: item.addressId,
	displayName: item.displayName,
	normalizedEmail: item.normalizedEmail,
	inboundCount: item.inboundCount ?? 0,
	outboundCount: item.outboundCount ?? 0,
	replyCount: item.replyCount ?? 0,
	lastInboundAt: item.lastInboundAt,
	lastReplyAt: item.lastReplyAt,
});
