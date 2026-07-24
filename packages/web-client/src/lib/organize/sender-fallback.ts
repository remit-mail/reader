import type {
	RemitImapFilterClause,
	RemitImapOrganizeInput,
} from "@remit/api-http-client/types.gen.ts";
import type { OrganizeDraft } from "./organize-model";

/**
 * The widen fallback for a deployment that ships no vector pipeline (self-host
 * sqlite — semantic-capability.ts). The semantic anchor matches nothing there,
 * so a widen degrades to the literal vocabulary RFC 031 already matches
 * vector-free: one `From` clause per distinct sender in the selection, combined
 * with `Or`, no anchor. The same predicate matches at index time (RFC 034), so a
 * standing filter built from it keeps working on future mail.
 */

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

/**
 * One `From` literal clause per distinct sender address. A `From` clause matches
 * the sender address or display name (match.ts `clauseMatches`), so the address
 * is the precise, stable key.
 */
export const deriveSenderClauses = (
	senders: readonly string[],
): RemitImapFilterClause[] =>
	distinctSenders(senders).map((value) => ({ field: "From", value }));

/**
 * The literal predicate that stands in for the semantic anchor: the sender `From`
 * clauses combined with `Or` and no anchor. The preview, the one-time back-apply,
 * and the standing filter all carry exactly this.
 */
export const buildSenderFallbackDraft = (
	senders: readonly string[],
): OrganizeDraft => ({
	matchOperator: "Or",
	literalClauses: deriveSenderClauses(senders),
});

/**
 * The predicate the widen previewed, handed to the organize sentence so the set
 * it previews equals the set every commit scope acts on. Either the semantic
 * anchor or the sender-derived literal fallback, never both.
 */
export type OrganizeMatchPredicate = Pick<
	RemitImapOrganizeInput,
	"anchorMessageId" | "matchOperator" | "literalClauses"
>;
