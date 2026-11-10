import type { SenderTrust } from "@remit/api-openapi-types";

/**
 * Search criteria resolved from the Message and Address rows rather than the
 * ThreadMessage row: `senderTrust` from AddressItem.flags and `dkimMismatch`
 * from MessageItem.authenticity. Both filter in the query; the API answers
 * `count` as absent under either.
 */
export interface OffRowCriteria {
	senderTrust?: SenderTrust[];
	dkimMismatch?: boolean;
}

export const hasOffRowCriteria = (criteria: OffRowCriteria): boolean =>
	Boolean(criteria.senderTrust?.length) || criteria.dkimMismatch !== undefined;
