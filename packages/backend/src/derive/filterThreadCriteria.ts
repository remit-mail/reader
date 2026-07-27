import type {
	SenderTrust,
	ThreadMessageResponse,
} from "@remit/api-openapi-types";

/**
 * Off-row search criteria — fields that live on the underlying Message/Address,
 * not on the ThreadMessage row. They are resolved by enriching the windowed
 * rows (see enrichThreadRows) and filtering in app code, because no index or
 * FilterExpression can serve them.
 *
 * `senderTrust` derives from AddressItem.flags and `dkimMismatch` from
 * MessageItem.authenticity. `category` is not one of these: it is denormalized
 * onto the ThreadMessage row and filtered in SQL, inside the window.
 */
export interface OffRowCriteria {
	senderTrust?: SenderTrust[];
	dkimMismatch?: boolean;
}

export const hasOffRowCriteria = (criteria: OffRowCriteria): boolean =>
	Boolean(criteria.senderTrust?.length) || criteria.dkimMismatch !== undefined;

/**
 * Filter enriched rows by the off-row criteria. Each active criterion is an
 * any-of set (AND across criteria, OR within a set). A row with no
 * `authenticity` signal never matches a `dkimMismatch` filter (absence means no
 * signal, not a verdict).
 */
export const filterByOffRowCriteria = (
	rows: ThreadMessageResponse[],
	criteria: OffRowCriteria,
): ThreadMessageResponse[] => {
	if (!hasOffRowCriteria(criteria)) return rows;

	const trustSet = criteria.senderTrust?.length
		? new Set(criteria.senderTrust)
		: undefined;
	const { dkimMismatch } = criteria;

	return rows.filter((row) => {
		if (trustSet && !trustSet.has(row.senderTrust)) return false;
		if (
			dkimMismatch !== undefined &&
			row.authenticity?.dkimMismatch !== dkimMismatch
		) {
			return false;
		}
		return true;
	});
};
