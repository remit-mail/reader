import { AuthResultVerdict, MessageCategory } from "@remit/domain-enums";
import type {
	Attachment,
	HeaderLines,
	Headers,
	ParsedMail,
	StructuredHeader,
} from "mailparser";
import { hasMachineHeader, isMachineLocalPart } from "./machineSenders.js";
import { SOCIAL_DOMAINS } from "./socialDomains.js";
import { TRANSACTIONAL_DOMAINS } from "./transactionalDomains.js";

type Category = (typeof MessageCategory)[keyof typeof MessageCategory];
type AuthVerdictValue =
	(typeof AuthResultVerdict)[keyof typeof AuthResultVerdict];

export interface MessageAuthResult {
	dmarc?: AuthVerdictValue;
	spf?: AuthVerdictValue;
	dkim?: AuthVerdictValue;
}

export interface MessageProviderSpam {
	classified: boolean;
	score?: string;
	source?: string;
}

/**
 * Structured sender-authenticity signal, persisted alongside `category`
 * during body-sync so the intelligence sidebar (#425) can render phishing
 * verdicts without re-parsing.
 *
 * `dkimMismatch` answers "is there strong evidence this message was NOT sent
 * by the domain it claims" — it drives `classifyPlacement`'s demote-to-Junk
 * path, a real IMAP move on a mailbox other clients also touch, so it is
 * deliberately conservative: `false` whenever EITHER the raw `DKIM-Signature`
 * header(s) or the `Authentication-Results` verdict shows an aligned domain,
 * even if the other source disagrees. A mailing list or corporate gateway
 * that legitimately re-signs on relay breaks the author's own signature, so
 * `Authentication-Results` (which only lists what actually verified) can
 * disagree with the raw headers (which still list the original, aligned `d=`
 * alongside the relay's) on entirely benign mail — trusting either source
 * alone here would move that mail to Junk. It is `true` only when every
 * available source agrees nothing aligns, or — with no signature at all —
 * `Authentication-Results` reports an explicit `dkim=fail` naming a domain
 * that itself does not align with the From domain (see `extractAuthenticity`
 * for why a bare or aligned failure does not count).
 *
 * `dkimDomain` is present whenever there is a reported domain worth showing;
 * absent when nothing was extracted, or when the only aligned evidence is an
 * unverified raw signature (see `extractAuthenticity`).
 *
 * Present only when at least one DKIM signal — a `DKIM-Signature` header or
 * an `Authentication-Results` result — exists at all; absent when the
 * message carries neither (absence means "no signal").
 */
export interface MessageAuthenticity {
	/** Domain of the From header address */
	fromDomain: string;
	/**
	 * The reported signing domain, when there is one worth showing.
	 *
	 * Comes from `Authentication-Results`' `header.d`/`header.i` for a
	 * `dkim=pass` result when one exists — the receiving side's own claim
	 * about who signed it (an unverified claim: reader does not check the
	 * header's `authserv-id`, see {@link extractAuthenticity}) — regardless of
	 * whether it happens to align, because that is always a more trustworthy
	 * identity than a raw signature's `d=`, which can name a relay that
	 * merely re-signed (#603). That preference is what makes this ONLY source
	 * ever reported for an ALIGNED domain: `dkimMismatch: false` with
	 * `dkimDomain` set is as confirmed as this signal gets.
	 *
	 * Falls back to the raw `DKIM-Signature` header only when no
	 * `Authentication-Results` result exists at all, and only to report a
	 * MISMATCHING domain — an unverified alignment is never reported: when the
	 * raw signature is the only signal and it happens to align, `dkimDomain`
	 * is left absent even though `dkimMismatch` is `false`, so the UI can
	 * tell "confirmed aligned" from "no evidence of misalignment, but
	 * unconfirmed" and never renders the latter as verified (#603).
	 */
	dkimDomain?: string;
	/** True when every available signal agrees the signing domain does not align with the From domain */
	dkimMismatch: boolean;
}

/**
 * Header-only classification. Pure function. First match wins. Falls through
 * to `personal` so misclassification stays in the safest bucket.
 *
 * Rules are ordered most-specific-signal first. Two properties drive the
 * order, and both were violated by the original table (issue #45):
 *
 * - A signal that identifies WHO sent the mail (calendar part, allow-listed
 *   domain) outranks a signal that only says the mail was sent in bulk.
 * - `Precedence` and `Auto-Submitted` say "a machine sent this", which is true
 *   of nearly every newsletter, marketing blast, and platform notification.
 *   Ranking them first collapsed `newsletter`, `marketing`, `social` and
 *   `transactional` into `automated`, leaving those buckets empty.
 *
 * 1. `Content-Type: text/calendar` part anywhere → `transactional`
 * 2. From-domain in TRANSACTIONAL_DOMAINS → `transactional`
 * 3. From-domain in SOCIAL_DOMAINS → `social`
 * 4. `List-Unsubscribe` AND `List-Id` → `newsletter`
 * 5. `List-Unsubscribe` only → `marketing`
 * 6. `Auto-Submitted: auto-generated|auto-replied` → `automated`
 * 7. `Precedence: bulk|list|junk` → `automated`
 * 8. Machine sender (no-reply local-part, `Feedback-ID`,
 *    `X-Auto-Response-Suppress`) → `automated`
 * 9. DKIM `d=` differs from From domain → `automated`
 * 10. fallback → `personal`
 */
export const classifyByHeaders = (parsed: ParsedMail): Category => {
	const headers = parsed.headers;
	const lines = parsed.headerLines;

	if (hasCalendarPart(parsed.attachments)) return MessageCategory.transactional;

	const fromDomain = getFromDomain(parsed);

	if (fromDomain && domainMatches(fromDomain, TRANSACTIONAL_DOMAINS)) {
		return MessageCategory.transactional;
	}

	if (fromDomain && domainMatches(fromDomain, SOCIAL_DOMAINS)) {
		return MessageCategory.social;
	}

	const hasListUnsubscribe = hasHeaderLine(lines, "list-unsubscribe");
	const hasListId = hasHeaderLine(lines, "list-id");

	if (hasListUnsubscribe && hasListId) return MessageCategory.newsletter;
	if (hasListUnsubscribe) return MessageCategory.marketing;

	if (matchesAutoSubmitted(headers)) return MessageCategory.automated;
	if (matchesPrecedence(headers)) return MessageCategory.automated;
	if (isMachineSender(parsed, lines)) return MessageCategory.automated;

	if (
		fromDomain &&
		pickAlignedOrFirstMismatch(extractDkimDomains(headers, lines), fromDomain)
			.mismatch
	) {
		return MessageCategory.automated;
	}

	return MessageCategory.personal;
};

/**
 * Extract the structured authenticity signal from parsed headers.
 *
 * Two sources, two different questions, deliberately not resolved the same
 * way:
 *
 * - "What domain do we present as verified?" — only ever
 *   `Authentication-Results`' `header.d`/`header.i` for a `dkim=pass` result,
 *   when one exists. A message relayed through a re-signing host carries
 *   that host's own `DKIM-Signature`, not the sender's, so the raw signature
 *   is never trusted for this question (#603).
 * - "Is there strong evidence this message wasn't sent by the domain it
 *   claims?" (`dkimMismatch`, which drives `classifyPlacement`'s
 *   demote-to-Junk path) — conservative by design: it takes EITHER source
 *   showing alignment as reason enough to say no. A gateway or mailing list
 *   that legitimately breaks the author's signature on relay still carries
 *   the original, aligned `d=` in the raw headers even though
 *   `Authentication-Results` — which only lists what actually verified —
 *   no longer does; trusting `Authentication-Results` alone here would move
 *   that ordinary relayed mail to Junk. Only when every available source
 *   agrees nothing aligns does `dkimMismatch` become `true`.
 *
 *   With no signature at all — the raw header stripped, or never sent — an
 *   explicit `Authentication-Results` `dkim=fail` result can still count,
 *   but only when it names a `header.d`/`header.i` domain that itself does
 *   NOT align with the From domain, run through the identical alignment
 *   check as everywhere else. A gateway that verifies a signature, finds the
 *   body hash broken by an intermediate relay, and reports `dkim=fail
 *   header.d=<the sender's own domain>` is not evidence of forgery — the
 *   domain named checks out, the crypto just didn't survive the trip — so
 *   that reads as no mismatch, same as a bare `dkim=fail` with no domain at
 *   all. Only a failure naming a domain that itself contradicts the From
 *   address is the unsigned-phishing shape this exists to catch.
 *
 * When more than one `dkim=pass` result is present in `Authentication-Results`
 * (e.g. a third-party ESP infrastructure signature alongside the sender's
 * own), the one aligned with the From domain wins over an earlier unrelated
 * one — the same aligned-signature-wins rule the raw-signature path already
 * used.
 *
 * Only the topmost `Authentication-Results` occurrence is read: each hop
 * prepends its own trace headers, so the topmost one is the most recently
 * added, by the hop closest to delivery. This is an unauthenticated hint,
 * not a cryptographic guarantee — reader does not check the header's
 * `authserv-id` against the account's configured receiving host, so a
 * hand-crafted `Authentication-Results` header reaching the mailbox
 * unfiltered is taken at face value, same as before this change.
 *
 * Returns `null` — no signal at all — when there is no `DKIM-Signature`
 * header, no `Authentication-Results` `dkim=pass` result, and either no
 * `Authentication-Results` `dkim=fail` result or one that names no domain.
 */
export const extractAuthenticity = (
	parsed: ParsedMail,
): MessageAuthenticity | null => {
	const fromDomain = getFromDomain(parsed);
	if (!fromDomain) return null;

	const headers = parsed.headers;
	const lines = parsed.headerLines;
	const rawDomains = extractDkimDomains(headers, lines);
	const authenticatedDomains = extractAuthenticatedDkimDomains(parsed);

	if (rawDomains.length === 0 && authenticatedDomains.length === 0) {
		// No passing signal to weigh against. A bare dkim=fail says a
		// signature failed verification, not that the sender is forged — a
		// corporate gateway that strips a broken signature after verifying it
		// produces exactly this shape, for entirely legitimate mail. A
		// failing result only counts as evidence when it names a domain, run
		// through the same alignment check as every other domain here:
		// aligned means the failure was for the claimed domain itself (relay
		// noise, not forgery, so no mismatch); unaligned means the failure
		// was for a domain that does not even match what the sender claims,
		// which is the mismatch this exists to catch.
		const failingDomains = extractFailingDkimDomains(parsed);
		if (failingDomains.length === 0) return null;

		const failing = pickAlignedOrFirstMismatch(failingDomains, fromDomain);
		return {
			fromDomain,
			dkimDomain: failing.mismatch ? (failing.domain ?? undefined) : undefined,
			dkimMismatch: failing.mismatch,
		};
	}

	const raw =
		rawDomains.length > 0
			? pickAlignedOrFirstMismatch(rawDomains, fromDomain)
			: null;
	const authenticated =
		authenticatedDomains.length > 0
			? pickAlignedOrFirstMismatch(authenticatedDomains, fromDomain)
			: null;

	// Mismatch only when every source that exists agrees — a single aligned
	// source (raw or authenticated) is reason enough to clear it. A source
	// that is entirely absent defaults to "would agree", so it never
	// overrides the source that IS present.
	const dkimMismatch =
		(raw?.mismatch ?? true) && (authenticated?.mismatch ?? true);

	// The domain to DISPLAY always prefers Authentication-Results when it has
	// anything at all, aligned or not (#603) — a raw-only domain is reported
	// only on a mismatch, exactly as before: an unverified alignment is not a
	// verified one.
	const dkimDomain = authenticated
		? (authenticated.domain ?? undefined)
		: dkimMismatch
			? (raw?.domain ?? undefined)
			: undefined;

	return { fromDomain, dkimDomain, dkimMismatch };
};

const extractVerdict = (
	text: string,
	mechanism: string,
): AuthVerdictValue | undefined => {
	const match = text.match(new RegExp(`${mechanism}=(\\w+)`, "i"));
	if (!match) return undefined;
	const raw = match[1].toLowerCase();
	const map: Record<string, AuthVerdictValue> = {
		pass: AuthResultVerdict.Pass,
		fail: AuthResultVerdict.Fail,
		none: AuthResultVerdict.None,
		neutral: AuthResultVerdict.Neutral,
		softfail: AuthResultVerdict.Softfail,
	};
	return map[raw];
};

/**
 * Extract provider authentication-results verdict from the Authentication-Results header.
 * Returns null when the header is absent.
 */
export const extractAuthResult = (
	parsed: ParsedMail,
): MessageAuthResult | null => {
	const line = parsed.headerLines.find(
		(l) => l.key.toLowerCase() === "authentication-results",
	);
	if (!line) return null;

	const text = stripHeaderName(line.line);
	const dmarc = extractVerdict(text, "dmarc");
	const spf = extractVerdict(text, "spf");
	const dkim = extractVerdict(text, "dkim");

	return { dmarc, spf, dkim };
};

/**
 * Every `header.d` (or `header.i` domain, when `header.d` is absent —
 * some verifiers emit only `header.i`) named by a `dkim=<verdict>` result in
 * the topmost `Authentication-Results` header, in the order they appear.
 *
 * `Authentication-Results` packs one or more `;`-delimited resinfo entries,
 * each naming a mechanism (`dkim=`, `spf=`, `dmarc=`) and its own properties
 * (`header.d=`, `header.i=`, `header.s=`, …). Splitting on `;` and anchoring
 * the verdict match to the START of each trimmed segment is what keeps this
 * from misreading a `dkim=` token sitting inside a DIFFERENT mechanism's
 * comment — `arc=fail (i=1 spf=pass dkim=fail …)` names no dkim result of
 * its own, and must never be read as one.
 *
 * A message can carry more than one result for the same verdict — e.g. an
 * ESP infrastructure domain's passing signature alongside the sender's own
 * — so every one is collected; the caller picks the one that aligns with the
 * From domain over an unrelated earlier one.
 */
const extractDkimResinfoDomains = (
	parsed: ParsedMail,
	verdict: "pass" | "fail",
): string[] => {
	const line = parsed.headerLines.find(
		(l) => l.key.toLowerCase() === "authentication-results",
	);
	if (!line) return [];

	const text = stripHeaderName(line.line);
	const verdictPattern = new RegExp(`^dkim\\s*=\\s*${verdict}\\b`, "i");
	const domains: string[] = [];
	for (const segment of text.split(";")) {
		const trimmed = segment.trim();
		if (!verdictPattern.test(trimmed)) continue;

		const dMatch = trimmed.match(/header\.d\s*=\s*"?([^"\s;]+)"?/i);
		if (dMatch) {
			domains.push(dMatch[1].trim().toLowerCase());
			continue;
		}

		const iMatch = trimmed.match(/header\.i\s*=\s*"?([^"\s;]+)"?/i);
		const iDomain = iMatch ? domainFromHeaderI(iMatch[1]) : null;
		if (iDomain) domains.push(iDomain);
	}
	return domains;
};

const extractAuthenticatedDkimDomains = (parsed: ParsedMail): string[] =>
	extractDkimResinfoDomains(parsed, "pass");

/**
 * Domains named by a `dkim=fail` result — never trusted as "verified"
 * (nothing passed), only weighed as possible mismatch evidence, and only
 * when {@link extractAuthenticity} has no passing signal to prefer instead.
 */
const extractFailingDkimDomains = (parsed: ParsedMail): string[] =>
	extractDkimResinfoDomains(parsed, "fail");

/** The domain part of a `header.i=` identity (`@sub.example.com` → `example.com`'s host, `sub.example.com`). */
const domainFromHeaderI = (headerI: string): string | null => {
	const unquoted = headerI.replace(/^"+|"+$/g, "");
	const at = unquoted.indexOf("@");
	if (at < 0 || at === unquoted.length - 1) return null;
	return unquoted
		.slice(at + 1)
		.trim()
		.toLowerCase();
};

/**
 * Extract provider spam-filter signal from X-SpamExperts-Class, X-Spam-Status,
 * or X-HalOne-Spam-Probability headers. Returns null when none are present.
 */
export const extractProviderSpam = (
	parsed: ParsedMail,
): MessageProviderSpam | null => {
	const lines = parsed.headerLines;

	const spamExperts = lines.find(
		(l) => l.key.toLowerCase() === "x-spamexperts-class",
	);
	if (spamExperts) {
		const value = stripHeaderName(spamExperts.line).trim().toLowerCase();
		return {
			classified: value === "spam",
			source: "x-spamexperts-class",
		};
	}

	const spamStatus = lines.find((l) => l.key.toLowerCase() === "x-spam-status");
	if (spamStatus) {
		const text = stripHeaderName(spamStatus.line).trim();
		const classified = text.toLowerCase().startsWith("yes");
		const scoreMatch = text.match(/score=([\d.+-]+)/i);
		return {
			classified,
			score: scoreMatch ? scoreMatch[1] : undefined,
			source: "x-spam-status",
		};
	}

	const halOne = lines.find(
		(l) => l.key.toLowerCase() === "x-halone-spam-probability",
	);
	if (halOne) {
		const value = stripHeaderName(halOne.line).trim();
		return {
			classified: parseFloat(value) > 0.5,
			score: value,
			source: "x-halone-spam-probability",
		};
	}

	return null;
};

/**
 * Returns true when a List-Unsubscribe header is present, indicating a
 * bulk/mailing-list sender.
 */
export const extractHasListUnsubscribe = (parsed: ParsedMail): boolean =>
	parsed.headerLines.some((l) => l.key.toLowerCase() === "list-unsubscribe");

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

/**
 * Whether the sender is a machine that does not read replies — a no-reply
 * local-part, or a header only bulk/notification infrastructure sets. This is
 * what routes platform notifications (npm, CI, password resets) to `automated`
 * instead of the `personal` fallback; they carry no list or bulk headers.
 */
const isMachineSender = (parsed: ParsedMail, lines: HeaderLines): boolean => {
	if (hasMachineHeader(lines.map((line) => line.key))) return true;
	const localPart = getFromLocalPart(parsed);
	return localPart !== null && isMachineLocalPart(localPart);
};

const getFromLocalPart = (parsed: ParsedMail): string | null => {
	const address = parsed.from?.value?.[0]?.address;
	if (!address) return null;
	const at = address.lastIndexOf("@");
	if (at <= 0) return null;
	return address.slice(0, at);
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
 * Whether a signing domain aligns with the From domain: equal, or one is a
 * subdomain of the other (parent/child). A legitimate re-mailer signing under
 * a subdomain is not suspicious, so either direction counts as aligned.
 */
const domainsAligned = (signingDomain: string, fromDomain: string): boolean =>
	signingDomain === fromDomain ||
	fromDomain.endsWith(`.${signingDomain}`) ||
	signingDomain.endsWith(`.${fromDomain}`);

/**
 * Pick the domain to report out of a list of candidate signing domains: the
 * first one aligned with the From domain, so a legitimate signature is never
 * shadowed by an earlier unrelated one (e.g. a third-party ESP
 * infrastructure signature alongside the sender's own — #603 CI finding B).
 * When none align, the first is reported as the mismatching evidence.
 */
const pickAlignedOrFirstMismatch = (
	domains: string[],
	fromDomain: string,
): { mismatch: boolean; domain: string | null } => {
	let firstMismatching: string | null = null;
	for (const d of domains) {
		if (domainsAligned(d, fromDomain)) return { mismatch: false, domain: d };
		if (!firstMismatching) firstMismatching = d;
	}
	return { mismatch: firstMismatching !== null, domain: firstMismatching };
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
