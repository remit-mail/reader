/**
 * What a search converts to (RFC 038 D5). The shape carries the clauses
 * alongside everything the search held that a filter cannot, so a conversion can
 * never drop a facet without saying so; `search-conversion.ts` beside it owns
 * the copy that states it.
 */

import type { ClauseField, MatchOperator } from "../components/filter-rule.js";
import type { SearchConversionNotice } from "../components/search-conversion.js";

/**
 * A search facet a filter has no clause for. Attachment, read state, starred,
 * category and the date bounds are attributes of a message, not text a clause
 * matches on.
 */
export type DroppedFacetType =
	| "hasAttachment"
	| "isUnread"
	| "isRead"
	| "isStarred"
	| "category"
	| "before"
	| "after";

export interface DroppedFacet {
	type: DroppedFacetType;
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
	 * The filter this conversion builds is always literal-only — free text has no
	 * anchor message for a semantic widen — so the search's semantic "similar mail"
	 * reach is dropped whenever the search had one (RFC 038 D5). True exactly when
	 * free text was kept AND the search surfaced semantically-similar mail; on a
	 * deployment with no semantic reach there was nothing to drop, so no note.
	 */
	droppedSemantic: boolean;
}

/**
 * Whether the conversion yields a rule with something to match. A search of only
 * dropped facets or a bare folder scope converts to no clauses, so there is no
 * filter to open — the entry point offers nothing rather than an empty editor.
 */
export const isConvertible = (conversion: SearchConversion): boolean =>
	conversion.clauses.length > 0;

/**
 * The conversion as the notice reads it. One mapping, beside both shapes, so
 * every surface that opens on a converted search states the same losses in the
 * same words.
 */
export const searchConversionNotice = (
	conversion: SearchConversion,
): SearchConversionNotice => ({
	scopedOutFolder: conversion.scopedOut?.label,
	droppedFacets: conversion.droppedFacets.map((facet) => facet.label),
	droppedSemantic: conversion.droppedSemantic,
});
