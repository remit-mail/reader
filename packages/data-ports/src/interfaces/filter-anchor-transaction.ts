import type {
	CreateFilterAnchorInput,
	CreateFilterInput,
	FilterItem,
} from "../types.js";

/**
 * Atomically creates a `Filter` row and its optional sibling `FilterAnchor`
 * row (#351). Without this, the two writes ran sequentially: a failure on the
 * second left a `Filter` durably marked `hasAnchor: true` with no matching
 * `FilterAnchor` row — a filter that looks normal but silently matches
 * nothing, forever, with no repair path (the anchor message id is never
 * retained once `createFilterWithAnchor` returns).
 *
 * `anchor` omits `filterId` — it is not known until the `Filter` row is
 * created inside the same transaction.
 */
export interface IFilterAnchorTransaction {
	createWithAnchor(
		filter: CreateFilterInput,
		anchor: Omit<CreateFilterAnchorInput, "filterId"> | null,
	): Promise<FilterItem>;
}
