import { DisplayNameCorrespondence } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { getDomain, parse as parseHost } from "tldts";

type CorrespondenceValue =
	(typeof DisplayNameCorrespondence)[keyof typeof DisplayNameCorrespondence];

/**
 * The two signals that survive a passing SPF/DKIM/DMARC check: a display name
 * that belongs to nobody at the sending domain, and body links that leave it.
 *
 * Both are deliberately aggressive, and both are computed only for mail the
 * provider's own filter already called spam (see {@link extractSenderMismatch}).
 * On a shared-tenant host — a free Atlassian, Salesforce or Zendesk instance —
 * the verified subdomain is chosen by whoever signed up, so a passing signature
 * proves the domain and nothing about the identity the message claims.
 */
export interface SenderMismatchSignals {
	displayNameCorrespondence?: CorrespondenceValue;
	offDomainLinkDomains?: string[];
}

export interface SenderMismatchContext {
	fromDomain: string;
	spamClassified: boolean;
	/**
	 * List-Unsubscribe present. Bulk mail routinely shows a brand name over an
	 * ESP's sending domain, so the display-name comparison says nothing there and
	 * is not made.
	 */
	bulkSender: boolean;
}

const MAX_LINK_DOMAINS = 10;

const normalize = (value: string): string =>
	value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The parts of a host a display name could honestly correspond to: the
 * registrable name without its public suffix, every subdomain label, and the
 * registrable domain run together. The suffix itself is dropped — `net` and
 * `com` sit inside half the brand names in existence.
 */
const correspondenceCandidates = (host: string): string[] => {
	const parsed = parseHost(host);
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

const editDistance = (a: string, b: string): number => {
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
 * Containment decides: the normalised name, or any word of it, appearing inside
 * the registrable domain or one of the domain's labels. `GitHub` sits inside
 * `notifications.github.com`; `InfoMedics` sits nowhere inside
 * `serviceupdatebank.atlassian.net`.
 *
 * A bounded edit distance is the secondary test, and only reaches names that
 * nearly match a label — `InfoMedics` against `1nfomedics.nl`. It cannot promote
 * an unrelated name on its own.
 */
export const classifyDisplayNameCorrespondence = (
	displayName: string | undefined,
	fromDomain: string,
): CorrespondenceValue => {
	const raw = (displayName ?? "").trim();
	if (raw === "" || raw.includes("@")) {
		return DisplayNameCorrespondence.NoClaim;
	}

	const name = normalize(raw);
	if (name.length < 3) return DisplayNameCorrespondence.NoClaim;

	const candidates = correspondenceCandidates(fromDomain);
	if (candidates.length === 0) return DisplayNameCorrespondence.NoClaim;

	const terms = [name, ...words(raw)];
	for (const term of terms) {
		for (const candidate of candidates) {
			if (candidate.includes(term) || term.includes(candidate)) {
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

const hrefsFromHtml = (html: string): string[] => {
	const out: string[] = [];
	const pattern = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
	let match = pattern.exec(html);
	while (match !== null) {
		out.push(match[1] ?? match[2] ?? match[3] ?? "");
		match = pattern.exec(html);
	}
	return out;
};

const urlsFromText = (text: string): string[] =>
	text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];

/**
 * Registrable domains the body's links point at, minus the sender's own.
 *
 * `mailto:`, `tel:`, in-page anchors and relative hrefs carry no destination
 * domain and are skipped; anything else is resolved public-suffix-aware through
 * tldts, so `co.uk` and `atlassian.net` both survive the comparison a naive dot
 * split gets wrong.
 */
export const extractOffDomainLinkDomains = (
	parsed: ParsedMail,
	fromDomain: string,
): string[] => {
	const senderDomain = getDomain(fromDomain);
	const html = typeof parsed.html === "string" ? parsed.html : "";
	const text = typeof parsed.text === "string" ? parsed.text : "";

	const seen = new Set<string>();
	const out: string[] = [];
	for (const href of [...hrefsFromHtml(html), ...urlsFromText(text)]) {
		const value = href.trim();
		if (value === "" || !/^https?:\/\//i.test(value)) continue;
		const domain = getDomain(value);
		if (domain === null || domain === senderDomain) continue;
		if (seen.has(domain)) continue;
		seen.add(domain);
		out.push(domain);
		if (out.length === MAX_LINK_DOMAINS) break;
	}
	return out;
};

/**
 * Both signals, gated on the provider's own spam verdict.
 *
 * The gate is what lets the checks be this aggressive: ordinary mail never
 * reaches them, so a brand name over an ESP domain or a newsletter full of
 * tracking links can never be flagged. Returns an empty object when the gate
 * does not open — the fields stay absent, meaning "not compared".
 */
export const extractSenderMismatch = (
	parsed: ParsedMail,
	context: SenderMismatchContext,
): SenderMismatchSignals => {
	if (!context.spamClassified) return {};

	const offDomainLinkDomains = extractOffDomainLinkDomains(
		parsed,
		context.fromDomain,
	);

	if (context.bulkSender) return { offDomainLinkDomains };

	return {
		displayNameCorrespondence: classifyDisplayNameCorrespondence(
			parsed.from?.value?.[0]?.name,
			context.fromDomain,
		),
		offDomainLinkDomains,
	};
};
