import type {
	DroppedFacet,
	DroppedFacetType,
	SearchConversion,
} from "@remit/ui";
import {
	type ParsedSearchQuery,
	type SearchToken,
	searchTokenLabel,
} from "../search-tokens";

/**
 * Filter-from-search (RFC 038 D5). A search is literal terms and facets; a filter
 * is clause chips. This is the conversion between them — the current search
 * becomes a pre-filled rule the shared chip editor opens on.
 *
 * The mapping is honest about what a filter cannot carry. A facet with no clause
 * equivalent is never silently folded into the rule: a folder scope is reported
 * as dropped-and-kept-out (the filter matches everywhere, not just there), the
 * attribute facets (attachment / read state / starred / category / date) are
 * reported as left out, and a free-text query kept as a literal `HasWords` clause
 * is reported as having lost its semantic "similar mail" reach on a deployment
 * that cannot embed the query (D5). Pure functions only — the capability is
 * injected, not probed here.
 */

interface ConvertOptions {
	/**
	 * Whether the current search surfaced semantically-similar mail (a non-empty
	 * "Related" section). This is the reach the literal filter cannot reproduce —
	 * the direct existing signal, read from the search's own semantic results, not
	 * a probe of deployment capability.
	 */
	searchHadSemanticReach: boolean;
}

const FACET_HAS_NO_CLAUSE: ReadonlySet<string> = new Set<DroppedFacetType>([
	"hasAttachment",
	"isUnread",
	"isRead",
	"isStarred",
	"category",
	"before",
	"after",
]);

const hasNoClauseEquivalent = (
	type: SearchToken["type"],
): type is Extract<SearchToken["type"], DroppedFacetType> =>
	FACET_HAS_NO_CLAUSE.has(type);

/**
 * Convert the current search into a rule's clauses and a record of what could not
 * be carried. Terms become a `HasWords` clause; a `from:` facet a `From` clause
 * and a `subject:` facet a `Subject` clause; an `in:` facet a kept-out folder
 * scope; `account:` the target account; the attribute facets are dropped. The search's terms are ANDed with its facets, so
 * the rule matches all of them (`all`).
 */
export const convertSearchToRule = (
	parsed: ParsedSearchQuery,
	{ searchHadSemanticReach }: ConvertOptions,
): SearchConversion => {
	const clauses: SearchConversion["clauses"] = [];
	const droppedFacets: DroppedFacet[] = [];
	let scopedOut: SearchConversion["scopedOut"];
	let targetAccountId: string | undefined;

	for (const token of parsed.tokens) {
		if (token.type === "from") {
			clauses.push({ field: "From", value: token.value });
			continue;
		}
		if (token.type === "subject") {
			clauses.push({ field: "Subject", value: token.value });
			continue;
		}
		if (token.type === "in") {
			scopedOut = { mailboxId: token.mailboxId, label: token.value };
			continue;
		}
		if (token.type === "account") {
			targetAccountId = token.accountId;
			continue;
		}
		if (hasNoClauseEquivalent(token.type)) {
			droppedFacets.push({ type: token.type, label: searchTokenLabel(token) });
		}
	}

	const freeText = parsed.freeText.trim();
	const keptTerms = freeText.length > 0;
	if (keptTerms) clauses.push({ field: "HasWords", value: freeText });

	return {
		clauses,
		matchOperator: "all",
		scopedOut,
		droppedFacets,
		targetAccountId,
		keptTerms,
		droppedSemantic: keptTerms && searchHadSemanticReach,
	};
};
