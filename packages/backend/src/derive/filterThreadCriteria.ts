import type {
	MessageCategory,
	SenderTrust,
	ThreadMessageResponse,
} from "@remit/api-openapi-types";

/**
 * Off-row search criteria — fields that live on the underlying Message/Address,
 * not on the ThreadMessage DynamoDB item. They are resolved by enriching the
 * windowed rows (see enrichThreadRows) and filtering in app code, because no
 * index or FilterExpression can serve them.
 */
export interface OffRowCriteria {
	senderTrust?: SenderTrust[];
	category?: MessageCategory[];
	dkimMismatch?: boolean;
}

export const hasOffRowCriteria = (criteria: OffRowCriteria): boolean =>
	Boolean(criteria.senderTrust?.length) ||
	Boolean(criteria.category?.length) ||
	criteria.dkimMismatch !== undefined;

/**
 * Filter enriched rows by the off-row criteria. Each active criterion is an
 * any-of set (AND across criteria, OR within a set). A row with no `category`
 * never matches a category filter; a row with no `authenticity` signal never
 * matches a `dkimMismatch` filter (absence means no signal, not a verdict).
 */
export const filterByOffRowCriteria = (
	rows: ThreadMessageResponse[],
	criteria: OffRowCriteria,
): ThreadMessageResponse[] => {
	if (!hasOffRowCriteria(criteria)) return rows;

	const trustSet = criteria.senderTrust?.length
		? new Set(criteria.senderTrust)
		: undefined;
	const categorySet = criteria.category?.length
		? new Set(criteria.category)
		: undefined;
	const { dkimMismatch } = criteria;

	return rows.filter((row) => {
		if (trustSet && !trustSet.has(row.senderTrust)) return false;
		if (
			categorySet &&
			(row.category === undefined || !categorySet.has(row.category))
		) {
			return false;
		}
		if (
			dkimMismatch !== undefined &&
			row.authenticity?.dkimMismatch !== dkimMismatch
		) {
			return false;
		}
		return true;
	});
};
