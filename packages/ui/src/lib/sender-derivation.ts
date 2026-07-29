/**
 * Senders in a selection turned into clauses (RFC 038 D2).
 *
 * The widen fallback for a deployment that ships no vector pipeline reaches for
 * this: the semantic anchor matches nothing there, so a widen degrades to the
 * literal vocabulary RFC 031 already matches vector-free — one `From` clause per
 * distinct sender, or a single `FromDomain` clause when they all sit on one
 * registrable domain. The same predicate matches at index time (RFC 034), so a
 * standing filter built from it keeps working on future mail.
 */

import { getDomain } from "tldts";
import type { EnvelopeAddress } from "../components/address-display.js";
import type { RuleClause } from "../components/filter-rule.js";

/**
 * Distinct sender addresses from the selection, trimmed, empties dropped, and
 * de-duplicated case-insensitively while preserving first-seen casing and order.
 */
export const distinctSenders = (senders: readonly string[]): string[] => {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of senders) {
		const value = raw.trim();
		if (value === "") continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
};

const hostOf = (address: string): string => {
	const at = address.lastIndexOf("@");
	return at >= 0 ? address.slice(at + 1) : address;
};

/**
 * The registrable domain behind a sender address, public-suffix aware (tldts
 * `getDomain`), or `null` when the address carries none. The one place an
 * address is turned into a `FromDomain` value — a clause the prefill derives and
 * a domain the value field suggests must be the same string, or the suggestion
 * would offer a domain the matcher never produces.
 */
export const senderDomain = (address: string): string | null =>
	getDomain(hostOf(address.trim()));

/**
 * The single registrable domain the whole selection collapses to, or `null` when
 * it does not collapse. A collapse needs at least two distinct senders that all
 * resolve to one registrable domain (public-suffix aware, via tldts `getDomain`)
 * — the "anyone at this domain" signal (RFC 038 D2). One sender stays a precise
 * `From` clause rather than widening a single address to its whole domain, and a
 * sender whose domain can't be resolved blocks the collapse.
 */
export const collapsibleDomain = (
	senders: readonly string[],
): string | null => {
	const distinct = distinctSenders(senders);
	if (distinct.length < 2) return null;
	let shared: string | null = null;
	for (const sender of distinct) {
		const domain = senderDomain(sender);
		if (domain === null) return null;
		if (shared === null) shared = domain;
		else if (shared !== domain) return null;
	}
	return shared;
};

/**
 * The literal clauses standing in for the selection. When every sender shares one
 * registrable domain, a single `FromDomain` clause replaces the per-address `From`
 * chips (RFC 038 D2); otherwise one `From` clause per distinct sender, each
 * matching the sender address or display name (match.ts `clauseMatches`).
 */
export const deriveSenderClauses = (
	senders: readonly string[],
): Omit<RuleClause, "id">[] => {
	const domain = collapsibleDomain(senders);
	if (domain !== null) return [{ field: "FromDomain", value: domain }];
	return distinctSenders(senders).map(
		(value): Omit<RuleClause, "id"> => ({ field: "From", value }),
	);
};

/**
 * The sender carrying most of a selection, or `undefined` when it carries none.
 * Whole envelope addresses rather than bare strings: this reads the display name
 * a person recognises, where the clause derivations above read the address a
 * matcher compares, and the two are not interchangeable.
 *
 * Counted on the normalized address, so one sender writing under two display
 * names is one sender; the answer is the first envelope seen for the winner.
 */
export const dominantSender = (
	senders: readonly EnvelopeAddress[],
): EnvelopeAddress | undefined => {
	const counts = new Map<string, { sender: EnvelopeAddress; count: number }>();
	for (const sender of senders) {
		const key = sender.normalizedEmail.trim().toLowerCase();
		if (key === "") continue;
		const seen = counts.get(key);
		if (seen) seen.count += 1;
		else counts.set(key, { sender, count: 1 });
	}
	let best: EnvelopeAddress | undefined;
	let bestCount = 0;
	for (const { sender, count } of counts.values()) {
		if (count <= bestCount) continue;
		best = sender;
		bestCount = count;
	}
	return best;
};

/** What a sender is called on screen — the display name, or the address when it has none. */
export const senderLabel = (sender: EnvelopeAddress): string =>
	sender.displayName?.trim() || sender.normalizedEmail;
