import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
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
 * reported as left out. Pure functions only.
 */

type NoClauseFacet = Extract<SearchToken["type"], DroppedFacetType>;

const FACET_HAS_NO_CLAUSE: ReadonlySet<SearchToken["type"]> =
	new Set<NoClauseFacet>([
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
): type is NoClauseFacet => FACET_HAS_NO_CLAUSE.has(type);

/**
 * Convert the current search into a rule's clauses and a record of what could not
 * be carried. Terms become a `HasWords` clause; a `from:` facet a `From` clause
 * and a `subject:` facet a `Subject` clause; an `in:` facet a kept-out folder
 * scope; `account:` the target account; the attribute facets are dropped. The search's terms are ANDed with its facets, so
 * the rule matches all of them (`all`).
 */
export const convertSearchToRule = (
	parsed: ParsedSearchQuery,
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
	};
};

/**
 * Which account a rule converted from a search belongs to (#524). A query names
 * one only through an explicit `account:` facet, which an ordinary search does
 * not carry; without it the rule belongs to the account whose mail the search
 * ran over, which is the account the surface handed over. Only a surface that
 * has no single account of its own leaves the first configured one to answer.
 */
export const searchRuleAccountId = (
	conversion: SearchConversion,
	surfaceAccountId: string | undefined,
	accounts: readonly Pick<RemitImapAccountResponse, "accountId">[],
): string | undefined =>
	conversion.targetAccountId ?? surfaceAccountId ?? accounts[0]?.accountId;
