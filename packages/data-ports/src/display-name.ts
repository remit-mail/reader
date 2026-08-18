/**
 * A display name that claims to be an email address (issue #826).
 *
 * The name on an envelope address is free text its sender chooses; the address
 * is verifiable. A spam envelope of
 * `matthijs@ischen.nl <aramirez@secresaludguaviare.gov.co>` therefore labels a
 * stranger's address with the reader's own, and every surface that shows a name
 * — the message list, the message header, contact autocomplete — repeats the
 * claim. On 2026-08-18 autocomplete offered such a row back and private mail
 * left the instance.
 *
 * The rule is one function because it has to hold in two places at once: the
 * harvest that decides what to store, and the repair that rewrites what is
 * already stored. Two spellings of it disagree at the edges — SQL `lower()`
 * folds ASCII only where JS folds all of Unicode — and every disagreement
 * rewrites a name on a live database that holds the only copy of it.
 *
 * What comes out is the name minus the claim, not the empty string. A sender
 * signing itself `Support (support@acme.com)` from `noreply@acme.com` is
 * ordinary mail, and `Support` is the name its recipient knows it by; deleting
 * that to remove the address takes real text off a live instance. Only the
 * address is removed, with the punctuation that was holding it, and a name that
 * is nothing but the claim comes back empty.
 *
 * An address the name shares with the address it labels is not a claim about
 * anyone else, so it stays — `Matthijs <matthijs@ischen.nl>` on
 * `matthijs@ischen.nl` is the same information twice.
 */

const EMBEDDED_ADDRESS =
	/[^\s@<>()[\],;:"'\\]+@[^\s@<>()[\],;:"'\\]+\.[^\s@<>()[\],;:"'\\.]{2,}/gu;

/** `( )`, `< >`, `""` — a delimiter pair the removed address was sitting in. */
const EMPTIED_PAIR = /[<([{"']\s*[>)\]}"']/gu;

/**
 * What is left holding the address once it is gone: the separators around it.
 * Brackets and quotes are not trimmed here — EMPTIED_PAIR has already taken the
 * ones that were wrapping the address, and a name can legitimately end in one.
 */
const EDGE_SEPARATORS = /^[\s,;:|/\\-]+|[\s,;:|/\\-]+$/gu;

const tidy = (text: string): string =>
	text
		.replace(EMPTIED_PAIR, " ")
		.replace(/\s+/gu, " ")
		.replace(EDGE_SEPARATORS, "")
		.trim();

/**
 * `normalizedEmail` absent means the envelope carried no address this name
 * could be describing, so any address in the name is a claim about nobody.
 */
const claimsAnotherAddress = (
	text: string,
	own: string | undefined,
): boolean => {
	for (const [address] of text.matchAll(EMBEDDED_ADDRESS)) {
		if (address.toLowerCase() !== own) return true;
	}
	return false;
};

/**
 * The display name as it should be stored, for both the harvest and the repair.
 * Unchanged when the name claims nothing.
 */
export const storedDisplayName = (
	displayName: string | undefined,
	normalizedEmail: string | undefined,
): string => {
	if (!displayName) return "";
	const own = normalizedEmail?.toLowerCase();
	if (!claimsAnotherAddress(displayName, own)) return displayName;

	const remainder = tidy(
		displayName.replace(EMBEDDED_ADDRESS, (address) =>
			address.toLowerCase() === own ? address : " ",
		),
	);
	// Stripping leaves at most the row's own address behind, so the re-check is a
	// backstop rather than a case: nothing that still claims another address is
	// ever stored, whatever the shape it was hiding in.
	if (!remainder || claimsAnotherAddress(remainder, own)) return "";
	return remainder;
};
