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

	if (fromDomain && dkimMismatchesFrom(headers, lines, fromDomain)) {
		return MessageCategory.automated;
	}

	if (fromDomain && domainMatches(fromDomain, SOCIAL_DOMAINS)) {
		return MessageCategory.social;
	}

	return MessageCategory.personal;
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

const dkimMismatchesFrom = (
	headers: Headers,
	lines: HeaderLines,
	fromDomain: string,
): boolean => {
	const dkimDomains = extractDkimDomains(headers, lines);
	if (dkimDomains.length === 0) return false;
	for (const d of dkimDomains) {
		if (
			d === fromDomain ||
			fromDomain.endsWith(`.${d}`) ||
			d.endsWith(`.${fromDomain}`)
		) {
			return false;
		}
	}
	return true;
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
