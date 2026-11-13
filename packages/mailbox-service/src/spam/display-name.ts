import { DisplayNameCorrespondence } from "@remit/domain-enums";

type CorrespondenceValue =
	(typeof DisplayNameCorrespondence)[keyof typeof DisplayNameCorrespondence];

export type Tldts = typeof import("tldts");

const normalize = (value: string): string =>
	value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The parts of a host a display name could honestly correspond to: the
 * registrable name without its public suffix, every subdomain label, and the
 * registrable domain run together. The suffix itself is dropped — `net` and
 * `com` sit inside half the brand names in existence.
 */
const correspondenceCandidates = (tldts: Tldts, host: string): string[] => {
	const parsed = tldts.parse(host);
	const labels = (parsed.subdomain ?? "").split(".");
	if (parsed.domainWithoutSuffix !== null) {
		labels.push(parsed.domainWithoutSuffix);
	} else {
		labels.push(...host.split(".").slice(0, -1));
	}
	if (parsed.domain !== null) labels.push(parsed.domain);
	return labels.map(normalize).filter((label) => label.length >= 3);
};

const words = (displayName: string): string[] =>
	displayName
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 3);

export const editDistance = (a: string, b: string): number => {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[b.length];
};

const ADDRESS_SHAPE = /[^\s<>@,;:"]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;

export const registrableDomain = (tldts: Tldts, host: string): string =>
	tldts.getDomain(host) ?? host.toLowerCase();

/**
 * The registrable domain of the address a display name spells out, or
 * `undefined` when it holds an `@` without an address behind it — `Bob @ Acme`
 * asserts no address and is left to the ordinary comparison.
 */
const claimedAddressDomain = (
	tldts: Tldts,
	displayName: string,
): string | undefined => {
	const host = ADDRESS_SHAPE.exec(displayName)?.[1];
	if (host === undefined) return undefined;
	return registrableDomain(tldts, host);
};

/**
 * The distance a name of this length may be from a domain label and still be
 * read as an imitation of it. Tight on purpose: an unrelated brand name and an
 * ESP's domain are always far apart, so distance alone must never decide.
 */
const lookalikeThreshold = (length: number): number => {
	if (length < 5) return 0;
	if (length < 9) return 1;
	return 2;
};

/**
 * Whether the From display name corresponds to the From domain.
 *
 * Containment decides: the normalised name, or any word of it, containing an
 * entire domain candidate. `GitHub` contains the label `github` from
 * `notifications.github.com`; `InfoMedics` contains no label of
 * `serviceupdatebank.atlassian.net`.
 *
 * Only that direction counts — a domain candidate containing the (shorter)
 * name does not. `ING Fraudedesk` is not a match for `secure-ing-verify.tk`
 * just because the three-letter word "ing" sits inside "secureingverify":
 * that is a coincidental substring of a longer label the domain owner chose,
 * not a domain that names the brand. The direction this drops is exactly the
 * one a short, valuable brand name is deliberately embedded into a longer,
 * unrelated-looking domain to exploit — the live Dutch-bank shape this was
 * fixed against (`ING`). A real short brand over its own domain (`ING` /
 * `ing.nl`) still matches: name and label are then equal, and equality
 * satisfies containment in either direction.
 *
 * A bounded edit distance is the secondary test, and only reaches names that
 * nearly match a label — `InfoMedics` against `1nfomedics.nl`. It cannot promote
 * an unrelated name on its own.
 *
 * A name that spells out an address is decided before any of that. Over the
 * sending domain it claims nothing — `billing@` shown over
 * `serviceupdatebank.atlassian.net` names the same party the envelope does.
 * Over any other registrable domain it is the strongest non-correspondence
 * signal there is: the message asserts, in the one field the recipient reads,
 * that it comes from an address that cannot have sent it.
 */
export const classifyDisplayNameCorrespondence = (
	displayName: string | undefined,
	fromDomain: string,
	tldts: Tldts,
): CorrespondenceValue => {
	const raw = (displayName ?? "").trim();
	if (raw === "") return DisplayNameCorrespondence.NoClaim;

	const claimed = claimedAddressDomain(tldts, raw);
	if (claimed !== undefined) {
		if (claimed === registrableDomain(tldts, fromDomain)) {
			return DisplayNameCorrespondence.NoClaim;
		}
		return DisplayNameCorrespondence.ForeignAddress;
	}

	const name = normalize(raw);
	if (name.length < 3) return DisplayNameCorrespondence.NoClaim;

	const candidates = correspondenceCandidates(tldts, fromDomain);
	if (candidates.length === 0) return DisplayNameCorrespondence.NoClaim;

	const terms = [name, ...words(raw)];
	for (const term of terms) {
		for (const candidate of candidates) {
			if (term.includes(candidate)) {
				return DisplayNameCorrespondence.Corresponds;
			}
		}
	}

	for (const candidate of candidates) {
		const threshold = lookalikeThreshold(
			Math.min(name.length, candidate.length),
		);
		if (threshold === 0) continue;
		if (Math.abs(name.length - candidate.length) > threshold) continue;
		if (editDistance(name, candidate) <= threshold) {
			return DisplayNameCorrespondence.Lookalike;
		}
	}

	return DisplayNameCorrespondence.Unrelated;
};
