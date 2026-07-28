import type { RemitImapFilterClause } from "@remit/api-http-client/types.gen.ts";
import { deriveSenderClauses, distinctSenders } from "./sender-fallback";

/**
 * The opening clauses for a rule matched on properties alone — no semantic
 * anchor (RFC 038 D2/D4). The selection is the only evidence available, so the
 * prefill reads it in the order the evidence is strongest:
 *
 * 1. One sender across the whole selection, or several that collapse to one
 *    registrable domain — the sender-fallback derivation (#251, #262) already
 *    decides between a `From` and a `FromDomain` clause, and this reuses it
 *    rather than deciding again.
 * 2. Mixed senders — what the messages share is their subject, so match on the
 *    part the subjects have in common instead.
 * 3. Neither — no clauses. The editor opens empty and asks for one; a wrong
 *    guess costs more than an absent one.
 *
 * Every clause it produces is an ordinary chip: visible, editable, removable.
 * It is where the user starts, never what the rule is.
 */

/** Reply, forward, and list-tag decorations that carry no meaning for a match. */
const SUBJECT_PREFIX =
	/^\s*(?:(?:re|aw|fwd?|vs|sv|antw|res|enc|tr)\s*(?:\[\d+\])?\s*:|\[[^\]]{1,32}\])\s*/i;

/**
 * A subject reduced to the part worth matching on: reply and forward markers
 * and leading list tags stripped (repeatedly — real threads stack them), and
 * whitespace collapsed.
 */
export const normalizeSubject = (subject: string): string => {
	let value = subject.replace(/\s+/g, " ").trim();
	for (;;) {
		const stripped = value.replace(SUBJECT_PREFIX, "");
		if (stripped === value) return value.trim();
		value = stripped;
	}
};

/**
 * Words too common to be a rule on their own. A single shared word from this
 * list matches half a mailbox, which is worse than offering nothing.
 */
const WEAK_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"have",
	"in",
	"is",
	"it",
	"me",
	"my",
	"new",
	"of",
	"on",
	"or",
	"our",
	"the",
	"this",
	"to",
	"was",
	"we",
	"with",
	"you",
	"your",
]);

/** The shortest fragment worth prefilling as a `Subject` clause. */
const MIN_FRAGMENT_LENGTH = 3;

const words = (subject: string): string[] =>
	subject.split(" ").filter((word) => word !== "");

const isUseful = (fragment: string[]): boolean => {
	if (fragment.length === 0) return false;
	if (fragment.join(" ").length < MIN_FRAGMENT_LENGTH) return false;
	return fragment.some((word) => !WEAK_WORDS.has(word.toLowerCase()));
};

const runAt = (haystack: string[], needle: string[]): number =>
	haystack.findIndex((_, start) =>
		needle.every(
			(word, offset) =>
				haystack[start + offset]?.toLowerCase() === word.toLowerCase(),
		),
	);

/**
 * The longest run of whole words every subject carries, compared
 * case-insensitively and returned in the casing the first subject uses. Whole
 * words rather than raw characters, so "Invoice 1841" and "Invoice 1902" share
 * "Invoice" and not "Invoice 18".
 *
 * `undefined` when the subjects share nothing worth matching on — a single
 * filler word does not count.
 */
export const sharedSubjectFragment = (
	subjects: readonly string[],
): string | undefined => {
	const normalized = subjects
		.map(normalizeSubject)
		.filter((subject) => subject !== "");
	if (normalized.length === 0) return undefined;
	const [first, ...rest] = normalized;
	if (rest.length === 0) return isUseful(words(first)) ? first : undefined;

	const firstWords = words(first);
	for (let length = firstWords.length; length > 0; length -= 1) {
		for (let start = 0; start + length <= firstWords.length; start += 1) {
			const candidate = firstWords.slice(start, start + length);
			if (!isUseful(candidate)) continue;
			if (rest.every((subject) => runAt(words(subject), candidate) >= 0)) {
				return candidate.join(" ");
			}
		}
	}
	return undefined;
};

/**
 * The clauses a properties-only rule opens on, derived from the selected
 * messages' senders and subjects. Empty when the selection gives nothing to go
 * on — the editor then holds the commit until the user adds a clause, which is
 * the honest state.
 */
export const derivePropertyClauses = (
	senders: readonly string[],
	subjects: readonly string[],
): RemitImapFilterClause[] => {
	const senderClauses = deriveSenderClauses(senders);
	// One sender across the selection, or several on one registrable domain:
	// a single sharp clause, and sharper than any subject fragment.
	if (distinctSenders(senders).length === 1) return senderClauses;
	if (senderClauses.length === 1 && senderClauses[0].field === "FromDomain")
		return senderClauses;

	const fragment = sharedSubjectFragment(subjects);
	if (fragment !== undefined) return [{ field: "Subject", value: fragment }];
	// Mixed senders with nothing shared in their subjects: one `From` chip each,
	// the widen fallback's own derivation (#251).
	return senderClauses;
};
