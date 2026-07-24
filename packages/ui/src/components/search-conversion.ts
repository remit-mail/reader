/**
 * The honest copy for turning a search into a filter (RFC 038 D5).
 *
 * A search carries reach a filter's clauses cannot: a folder it was limited to,
 * attribute facets that are not clauses, and — where the deployment can embed a
 * query at request time — semantic similarity. The conversion never drops any of
 * that silently. This module is the vocabulary the conversion notice renders; the
 * web-client computes which parts apply and feeds the notice.
 */

export interface SearchConversionNotice {
	/** The folder the search was limited to, kept OUT of the filter. */
	scopedOutFolder?: string;
	/** Facet labels with no clause equivalent (e.g. "Has attachment", "Before 2026-01-01"). */
	droppedFacets?: string[];
	/**
	 * Free text was kept as a literal `HasWords` clause, but this deployment
	 * cannot match it by meaning (RFC 038 D5) — the "similar mail" reach the
	 * search had is not in the filter.
	 */
	droppedSemantic?: boolean;
}

/** True when the conversion left something behind worth stating. */
export function hasConversionNotice(notice: SearchConversionNotice): boolean {
	return (
		notice.scopedOutFolder !== undefined ||
		(notice.droppedFacets?.length ?? 0) > 0 ||
		notice.droppedSemantic === true
	);
}

/** Never silently turn a folder-scoped search into a filter that matches everywhere. */
export function scopedOutCopy(folder: string): string {
	return `Your search was limited to ${folder}. This filter matches these messages in any folder — it can't be pinned to one.`;
}

const joinFacets = (facets: string[]): string => {
	if (facets.length === 1) return facets[0];
	if (facets.length === 2) return `${facets[0]} and ${facets[1]}`;
	return `${facets.slice(0, -1).join(", ")} and ${facets[facets.length - 1]}`;
};

/** Name each attribute facet a filter cannot express, rather than dropping it unremarked. */
export function droppedFacetsCopy(facets: string[]): string {
	const noun = facets.length === 1 ? "a filter condition" : "filter conditions";
	const verb = facets.length === 1 ? "isn't" : "aren't";
	return `${joinFacets(facets)} ${verb} ${noun}, so ${
		facets.length === 1 ? "it was" : "they were"
	} left out — the filter still matches everything else you searched for.`;
}

/** No "similar" claim where the deployment cannot embed the query (RFC 038 D5). */
export const DROPPED_SEMANTIC_COPY =
	"Your words become a literal match. This deployment can't match mail by meaning, so the filter finds mail containing these words — not other mail that means the same thing.";
