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
 * The rule is one predicate because it has to hold in two places at once: the
 * harvest that decides what to store, and the repair that clears what is
 * already stored. Two spellings of it disagree at the edges — SQL `lower()`
 * folds ASCII only where JS folds all of Unicode — and every disagreement
 * destroys a name on a live database.
 *
 * A name is refused when it carries an address anywhere in it that is not the
 * address it labels: `Matthijs <matthijs@ischen.nl>` on a Colombian government
 * address is the same lie as the bare address, one word longer. A name that
 * carries only the address it labels says nothing false and is kept.
 */

const EMBEDDED_ADDRESS =
	/[^\s@<>()[\],;:"'\\]+@[^\s@<>()[\],;:"'\\]+\.[^\s@<>()[\],;:"'\\.]{2,}/gu;

/**
 * `normalizedEmail` absent means the envelope carried no address this name
 * could be describing, so any address in the name is a claim about nobody.
 */
export const isImpersonatingDisplayName = (
	displayName: string | undefined,
	normalizedEmail: string | undefined,
): boolean => {
	if (!displayName) return false;
	const own = normalizedEmail?.toLowerCase();
	for (const [address] of displayName.matchAll(EMBEDDED_ADDRESS)) {
		if (address.toLowerCase() !== own) return true;
	}
	return false;
};

/**
 * The SQL narrowing that precedes the predicate: every string the predicate can
 * refuse contains `x@y.zz`, so a row this pattern misses cannot be impersonating
 * and never has to be read. `LIKE` is a superset, never the decision — the
 * decision is always `isImpersonatingDisplayName`.
 */
export const EMBEDDED_ADDRESS_LIKE = "%_@_%.__%";
