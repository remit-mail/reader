import type { ClauseField, Suggestion } from "@remit/ui";
import { senderDomain } from "@remit/ui";

/**
 * Values worth offering while a clause is being typed. The rule editor's value
 * field used to be bare text entry, so a `From` clause meant recalling an
 * address exactly and a `FromDomain` clause meant knowing what the matcher
 * considers a registrable domain.
 *
 * The offer is a shortcut and never a constraint: nothing here can reject or
 * rewrite what the user typed, and a field with no matches is the plain text box
 * it always was.
 */

/** An address a suggestion can be built from. */
export interface KnownAddress {
	email: string;
	displayName?: string;
	/**
	 * The address came off the messages the user selected, rather than a lookup.
	 * These are the likeliest answers, so they lead the list and say where they
	 * came from.
	 */
	fromSelection?: boolean;
}

/** How many suggestions the list shows at most. */
export const CLAUSE_SUGGESTION_LIMIT = 8;

/**
 * Whether a clause field takes values that come from addresses. `Subject`,
 * `HasWords`, and `ListId` are free text with nothing to draw on, and stay so.
 */
export const fieldTakesAddressSuggestions = (field: ClauseField): boolean =>
	field === "From" || field === "FromDomain";

const addressSuggestion = (address: KnownAddress): Suggestion => ({
	value: address.email,
	label: address.displayName ?? address.email,
	...(address.displayName ? { hint: address.email } : {}),
	...(address.fromSelection ? { source: "selected" } : {}),
});

const domainSuggestion = (address: KnownAddress): Suggestion | undefined => {
	const domain = senderDomain(address.email);
	if (domain === null) return undefined;
	return {
		value: domain,
		...(address.fromSelection ? { source: "selected" } : {}),
	};
};

const matches = (suggestion: Suggestion, query: string): boolean =>
	suggestion.value.toLowerCase().includes(query) ||
	(suggestion.label ?? "").toLowerCase().includes(query);

/**
 * The suggestions for one clause draft. `addresses` is given in priority order —
 * the selection's own senders first — and duplicates collapse onto the first
 * occurrence, so a selected address keeps its "selected" marking even when a
 * lookup returns it too.
 *
 * An empty query offers the lot, which is what makes the selection's addresses
 * available before a single key is pressed. A query that exactly matches an
 * offer drops it: there is nothing left to shortcut.
 */
export const buildClauseSuggestions = (
	field: ClauseField,
	query: string,
	addresses: readonly KnownAddress[],
): Suggestion[] => {
	if (!fieldTakesAddressSuggestions(field)) return [];
	const needle = query.trim().toLowerCase();
	const seen = new Set<string>();
	const out: Suggestion[] = [];
	for (const address of addresses) {
		if (address.email.trim() === "") continue;
		const suggestion =
			field === "From" ? addressSuggestion(address) : domainSuggestion(address);
		if (!suggestion) continue;
		const key = suggestion.value.toLowerCase();
		if (key === "" || seen.has(key)) continue;
		seen.add(key);
		if (key === needle) continue;
		if (needle !== "" && !matches(suggestion, needle)) continue;
		out.push(suggestion);
		if (out.length === CLAUSE_SUGGESTION_LIMIT) break;
	}
	return out;
};
