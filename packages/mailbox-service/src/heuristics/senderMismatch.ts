import type { DisplayNameCorrespondence } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import {
	classifyDisplayNameCorrespondence,
	type Tldts,
} from "../spam/display-name.js";
import { linksOf } from "../spam/links.js";

type CorrespondenceValue =
	(typeof DisplayNameCorrespondence)[keyof typeof DisplayNameCorrespondence];

/**
 * The two signals that survive a passing SPF/DKIM/DMARC check: a display name
 * that belongs to nobody at the sending domain, and body links that leave it.
 *
 * On a shared-tenant host — a free Atlassian, Salesforce or Zendesk instance —
 * the verified subdomain is chosen by whoever signed up, so a passing signature
 * proves the domain and nothing about the identity the message claims.
 */
export interface SenderMismatchSignals {
	displayNameCorrespondence?: CorrespondenceValue;
	offDomainLinkDomains: string[];
}

export interface SenderMismatchContext {
	fromDomain: string;
	/**
	 * List-Unsubscribe present. Bulk mail routinely shows a brand name over an
	 * ESP's sending domain, so the display-name comparison says nothing there and
	 * is not made.
	 */
	bulkSender: boolean;
}

const MAX_LINK_DOMAINS = 10;

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
	tldts: Tldts,
): string[] => {
	const senderDomain = tldts.getDomain(fromDomain);
	const html = typeof parsed.html === "string" ? parsed.html : "";
	const text = typeof parsed.text === "string" ? parsed.text : "";

	const seen = new Set<string>();
	const out: string[] = [];
	for (const { href } of linksOf(html, text)) {
		const value = href.trim();
		if (value === "" || !/^https?:\/\//i.test(value)) continue;
		const domain = tldts.getDomain(value);
		if (domain === null || domain === senderDomain) continue;
		if (seen.has(domain)) continue;
		seen.add(domain);
		out.push(domain);
		if (out.length === MAX_LINK_DOMAINS) break;
	}
	return out;
};

/**
 * Both signals, for every message with an authenticity result. A bulk sender
 * gets only the link comparison: a brand name over an ESP domain is normal
 * there, so the display-name comparison is not made and stays absent.
 */
export const extractSenderMismatch = async (
	parsed: ParsedMail,
	context: SenderMismatchContext,
): Promise<SenderMismatchSignals> => {
	const tldts = await import("tldts");
	const offDomainLinkDomains = extractOffDomainLinkDomains(
		parsed,
		context.fromDomain,
		tldts,
	);

	if (context.bulkSender) return { offDomainLinkDomains };

	return {
		displayNameCorrespondence: classifyDisplayNameCorrespondence(
			parsed.from?.value?.[0]?.name,
			context.fromDomain,
			tldts,
		),
		offDomainLinkDomains,
	};
};
