import { MessageCategory } from "@remit/domain-enums";
import type {
	Attachment,
	HeaderLines,
	Headers,
	ParsedMail,
	StructuredHeader,
} from "mailparser";
import { SOCIAL_DOMAINS } from "./socialDomains.js";
import { TRANSACTIONAL_DOMAINS } from "./transactionalDomains.js";

type Category = (typeof MessageCategory)[keyof typeof MessageCategory];

/**
 * Structured sender-authenticity signal extracted from DKIM headers.
 * Persisted alongside `category` during body-sync so the intelligence
 * sidebar (#425) can render phishing verdicts without re-parsing.
 *
 * Present only when a DKIM-Signature header exists; absent otherwise
 * (absence means "no signal" — no comparison was possible).
 */
export interface MessageAuthenticity {
	/** Domain of the From header address */
	fromDomain: string;
	/** DKIM signing domain (d=) that was compared, when a signature is present */
	dkimDomain?: string;
	/** True when none of the DKIM signing domains aligns with the From domain */
	dkimMismatch: boolean;
}

/**
 * Header-only classification. Pure function. First match wins. Falls through
 * to `personal` so misclassification stays in the safest bucket.
 *
 * Rule order matches the EDD heuristic table:
 *
 * 1. `Auto-Submitted: auto-generated|auto-replied` → `automated`
 * 2. `Precedence: bulk|list|junk` → `automated`
 * 3. `Content-Type: text/calendar` part anywhere → `transactional`
 * 4. From-domain in TRANSACTIONAL_DOMAINS → `transactional`
 * 5. `List-Unsubscribe` AND `List-Id` → `newsletter`
 * 6. `List-Unsubscribe` only → `marketing`
 * 7. DKIM `d=` differs from From domain → `automated`
 * 8. From-domain in SOCIAL_DOMAINS → `social`
 * 9. fallback → `personal`
 */
export const classifyByHeaders = (parsed: ParsedMail): Category => {
	const headers = parsed.headers;
	const lines = parsed.headerLines;

	if (matchesAutoSubmitted(headers)) return MessageCategory.automated;
	if (matchesPrecedence(headers)) return MessageCategory.automated;
	if (hasCalendarPart(parsed.attachments)) return MessageCategory.transactional;

	const fromDomain = getFromDomain(parsed);

	if (fromDomain && domainMatches(fromDomain, TRANSACTIONAL_DOMAINS)) {
		return MessageCategory.transactional;
	}

	const hasListUnsubscribe = hasHeaderLine(lines, "list-unsubscribe");
	const hasListId = hasHeaderLine(lines, "list-id");

	if (hasListUnsubscribe && hasListId) return MessageCategory.newsletter;
	if (hasListUnsubscribe) return MessageCategory.marketing;

	if (fromDomain && dkimMismatchResult(headers, lines, fromDomain).mismatch) {
		return MessageCategory.automated;
	}

	if (fromDomain && domainMatches(fromDomain, SOCIAL_DOMAINS)) {
		return MessageCategory.social;
	}

	return MessageCategory.personal;
};

/**
 * Extract the structured authenticity signal from parsed headers.
 *
 * Returns a `MessageAuthenticity` when at least one DKIM-Signature header
 * is present (a comparison was possible). Returns `null` when there are no
 * DKIM-Signature headers so callers can omit the field entirely — absence
 * means "no signal", not "mismatch: false".
 *
 * The alignment rule exactly mirrors the category heuristic (rule 7) so the
 * structured `dkimMismatch` boolean and the `automated` category can never
 * disagree.
 */
export const extractAuthenticity = (
	parsed: ParsedMail,
): MessageAuthenticity | null => {
	const headers = parsed.headers;
	const lines = parsed.headerLines;
	const fromDomain = getFromDomain(parsed);

	if (!fromDomain) return null;

	const dkimDomains = extractDkimDomains(headers, lines);
	if (dkimDomains.length === 0) return null;

	const result = dkimMismatchResult(headers, lines, fromDomain);

	// Pick the reported domain: first mismatching one on mismatch, first domain otherwise.
	const reportedDomain = result.mismatchingDomain ?? dkimDomains[0];

	return {
		fromDomain,
		dkimDomain: reportedDomain,
		dkimMismatch: result.mismatch,
	};
};

const matchesAutoSubmitted = (headers: Headers): boolean => {
	const value = readStringHeader(headers, "auto-submitted");
	if (!value) return false;
	const normalized = value.split(";")[0].trim().toLowerCase();
	return normalized === "auto-generated" || normalized === "auto-replied";
};

const matchesPrecedence = (headers: Headers): boolean => {
	const value = readStringHeader(headers, "precedence");
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "bulk" || normalized === "list" || normalized === "junk"
	);
};

const hasCalendarPart = (attachments: Attachment[] | undefined): boolean => {
	if (!attachments) return false;
	for (const att of attachments) {
		if ((att.contentType ?? "").toLowerCase().startsWith("text/calendar")) {
			return true;
		}
	}
	return false;
};

const getFromDomain = (parsed: ParsedMail): string | null => {
	const from = parsed.from;
	if (!from || !from.value || from.value.length === 0) return null;
	const address = from.value[0]?.address;
	if (!address) return null;
	const at = address.lastIndexOf("@");
	if (at < 0 || at === address.length - 1) return null;
	return address.slice(at + 1).toLowerCase();
};

const domainMatches = (
	domain: string,
	allowList: readonly string[],
): boolean => {
	for (const entry of allowList) {
		if (domain === entry || domain.endsWith(`.${entry}`)) return true;
	}
	return false;
};

/**
 * Check whether DKIM signing domain(s) align with the From domain and
 * return a structured result so both the category heuristic and the
 * authenticity extractor share the exact same alignment logic.
 *
 * Alignment: signing domain equals From domain, or one is a subdomain of
 * the other (parent/child). Any single aligned domain is enough to consider
 * the message non-mismatching — a legitimate re-mailer signing under a
 * subdomain is not suspicious.
 *
 * On mismatch the first non-aligned domain is reported so the UI can show
 * "signed by relay.example.net, claims example.com".
 */
const dkimMismatchResult = (
	headers: Headers,
	lines: HeaderLines,
	fromDomain: string,
): { mismatch: boolean; mismatchingDomain: string | null } => {
	const dkimDomains = extractDkimDomains(headers, lines);
	if (dkimDomains.length === 0)
		return { mismatch: false, mismatchingDomain: null };
	let firstMismatching: string | null = null;
	for (const d of dkimDomains) {
		if (
			d === fromDomain ||
			fromDomain.endsWith(`.${d}`) ||
			d.endsWith(`.${fromDomain}`)
		) {
			return { mismatch: false, mismatchingDomain: null };
		}
		if (!firstMismatching) firstMismatching = d;
	}
	return { mismatch: true, mismatchingDomain: firstMismatching };
};

const extractDkimDomains = (headers: Headers, lines: HeaderLines): string[] => {
	const domains: string[] = [];

	const raw = headers.get("dkim-signature");
	const structured = collectStructured(raw);
	for (const s of structured) {
		const d = s.params?.d;
		if (typeof d === "string") domains.push(d.trim().toLowerCase());
	}

	for (const line of lines) {
		if (line.key.toLowerCase() !== "dkim-signature") continue;
		const value = stripHeaderName(line.line);
		const match = value.match(/(?:^|;)\s*d\s*=\s*([^;\s]+)/i);
		if (match) {
			const candidate = match[1].trim().toLowerCase();
			if (!domains.includes(candidate)) domains.push(candidate);
		}
	}
	return domains;
};

const collectStructured = (value: unknown): StructuredHeader[] => {
	if (!value) return [];
	if (Array.isArray(value)) {
		const out: StructuredHeader[] = [];
		for (const v of value) {
			if (isStructuredHeader(v)) out.push(v);
		}
		return out;
	}
	if (isStructuredHeader(value)) return [value];
	return [];
};

const isStructuredHeader = (v: unknown): v is StructuredHeader => {
	if (!v || typeof v !== "object") return false;
	return (
		"value" in v &&
		typeof (v as { value: unknown }).value === "string" &&
		"params" in v &&
		typeof (v as { params: unknown }).params === "object"
	);
};

const stripHeaderName = (line: string): string => {
	const idx = line.indexOf(":");
	return idx >= 0 ? line.slice(idx + 1).trim() : line;
};

const hasHeaderLine = (lines: HeaderLines, name: string): boolean => {
	const lc = name.toLowerCase();
	for (const line of lines) {
		if (line.key.toLowerCase() === lc) return true;
	}
	return false;
};

const readStringHeader = (
	headers: Headers,
	key: string,
): string | undefined => {
	const value = headers.get(key);
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const first = value[0];
		if (typeof first === "string") return first;
	}
	return undefined;
};
