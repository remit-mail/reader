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
	 * Free text was kept as a literal `HasWords` clause, and the search had
	 * surfaced similar mail by meaning that the literal filter cannot reproduce
	 * (RFC 038 D5) — the "similar mail" reach is not part of the filter.
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

/**
 * States the filter is literal-only, so the search's similar-mail reach is not
 * carried (RFC 038 D5). Shown only where that reach existed — a capable search
 * that surfaced similar mail — so it never claims a reach the filter had.
 */
export const DROPPED_SEMANTIC_COPY =
	"The filter matches these words literally. Your search also found similar mail by meaning — a filter can't carry that, so it won't catch mail that means the same thing without these words.";
