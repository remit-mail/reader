import type {
	ClauseField,
	FilterRule,
	MatchOperator,
	RuleScope,
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
 * attribute facets (attachment / unread / date) are reported as left out, and a
 * free-text query kept as a literal `HasWords` clause is reported as having lost
 * its semantic "similar mail" reach on a deployment that cannot embed the query
 * (D5). Pure functions only — the capability is injected, not probed here.
 */

export interface DroppedFacet {
	/** The facet that had no clause equivalent. */
	type: SearchToken["type"];
	/** What was dropped, named for the user (e.g. "Has attachment", "Before 2026-01-01"). */
	label: string;
}

export interface ScopedOutFolder {
	mailboxId: string;
	/** The folder the search was limited to. */
	label: string;
}

export interface SearchConversion {
	/** Clauses derived from the search — `From` (a `from:` facet) and `HasWords` (the free text). */
	clauses: { field: ClauseField; value: string }[];
	matchOperator: MatchOperator;
	/** A folder an `in:` facet scoped the search to — kept OUT of the rule (never silently unscoped). */
	scopedOut?: ScopedOutFolder;
	/** Facets with no clause equivalent, each named. */
	droppedFacets: DroppedFacet[];
	/** The account an `account:` facet targets — the filter is created for it. */
	targetAccountId?: string;
	/** The search carried free-text terms, kept as a `HasWords` clause. */
	keptTerms: boolean;
	/**
	 * Free text was kept literally but this deployment cannot embed the query at
	 * request time, so the semantic "similar mail" widening is dropped (RFC 038
	 * D5). False when there is no free text or the deployment can serve it.
	 */
	droppedSemantic: boolean;
}

interface ConvertOptions {
	/** Whether the deployment can serve request-time semantic matching (existing signal). */
	semanticAvailable: boolean;
}

const FACET_HAS_NO_CLAUSE: ReadonlySet<SearchToken["type"]> = new Set([
	"hasAttachment",
	"isUnread",
	"before",
	"after",
]);

/**
 * Convert the current search into a rule's clauses and a record of what could not
 * be carried. Terms become a `HasWords` clause; a `from:` facet a `From` clause;
 * an `in:` facet a kept-out folder scope; `account:` the target account; the
 * attribute facets are dropped. The search's terms are ANDed with its facets, so
 * the rule matches all of them (`all`).
 */
export const convertSearchToRule = (
	parsed: ParsedSearchQuery,
	{ semanticAvailable }: ConvertOptions,
): SearchConversion => {
	const clauses: SearchConversion["clauses"] = [];
	const droppedFacets: DroppedFacet[] = [];
	let scopedOut: ScopedOutFolder | undefined;
	let targetAccountId: string | undefined;

	for (const token of parsed.tokens) {
		if (token.type === "from") {
			clauses.push({ field: "From", value: token.value });
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
		if (FACET_HAS_NO_CLAUSE.has(token.type)) {
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
		droppedSemantic: keptTerms && !semanticAvailable,
	};
};

/**
 * Whether the conversion yields a rule with something to match. A search of only
 * dropped facets or a bare folder scope converts to no clauses, so there is no
 * filter to open — the entry point offers nothing rather than an empty editor.
 */
export const isConvertible = (conversion: SearchConversion): boolean =>
	conversion.clauses.length > 0;

interface BuildRuleOptions {
	scope?: RuleScope;
	moveMailboxId?: string;
}

/**
 * The rule the editor opens on, from a conversion. A search-derived rule defaults
 * to a standing filter — "make this a filter" is a request to keep applying it —
 * and the editor lets the user drop it back to a one-time apply. It carries no
 * widen: a free-text query has no message anchor, so the semantic chip is not
 * offered on this surface (its loss is stated in the conversion notice instead).
 */
export const buildSearchRule = (
	conversion: SearchConversion,
	{ scope = "standing", moveMailboxId }: BuildRuleOptions = {},
): FilterRule => ({
	clauses: conversion.clauses.map((clause, index) => ({
		id: `search-${index}`,
		field: clause.field,
		value: clause.value,
	})),
	matchOperator: conversion.matchOperator,
	moveMailboxId,
	scope,
	name: "",
});
