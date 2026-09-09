import type { AddressItem, SenderSignerStandingItem } from "@remit/data-ports";
import {
	AuthenticityVerdict,
	AuthResultVerdict,
	DisplayNameCorrespondence,
} from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { getDomain } from "tldts";
import {
	extractAuthenticity,
	extractAuthResult,
	extractHasListUnsubscribe,
	extractProviderSpam,
} from "./classifyByHeaders.js";
import { extractSenderMismatch } from "./senderMismatch.js";

type CorrespondenceValue =
	(typeof DisplayNameCorrespondence)[keyof typeof DisplayNameCorrespondence];

/**
 * The value type of the {@link AuthenticityVerdict} enum — the tier written to
 * `Message.authenticityVerdict`.
 */
export type AuthenticityVerdictValue =
	(typeof AuthenticityVerdict)[keyof typeof AuthenticityVerdict];

/**
 * The reserved signer-domain literal for the pseudo-pair a message with no
 * verifiable DKIM identity is counted under: `senderKey` then carries the full
 * From address rather than the From domain, so one unverifiable message cannot
 * earn quiet treatment for every other address at its domain.
 */
const UNVERIFIED_SIGNER_DOMAIN = "unverified";

/**
 * The `(senderKey, signerDomain)` pair a message is observed under, and the
 * pair whose standing the derivation asks about — one key format, read and
 * written by the same derivation, so the two can never disagree.
 */
export interface StandingPairKeys {
	senderKey: string;
	signerDomain: string;
}

/**
 * The From address the recipient reads, when there is one to read: present,
 * and split into a non-empty local part and a non-empty domain. A message
 * whose From header carries no parseable address is the strongest
 * impersonation signal there is, so its shape is decided here once and reused
 * by every rule that needs an address or a domain.
 */
const readableFromAddress = (parsed: ParsedMail): string | null => {
	const address = parsed.from?.value?.[0]?.address;
	if (!address) return null;
	const at = address.lastIndexOf("@");
	if (at <= 0 || at === address.length - 1) return null;
	return address;
};

const domainOfAddress = (address: string): string =>
	address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/**
 * The pair this message counts against: the (From domain, DKIM signer domain)
 * pair when a DKIM-Signature header exists, and the address-keyed pseudo-pair
 * (`signerDomain = "unverified"`) when none does — the two scopes the
 * SenderSignerStanding model defines. `null` when the From address is not
 * readable: with no address there is no key to observe under, and the caller
 * treats that as "no standing".
 *
 * The signer domain is the registrable domain of the DKIM `d=` that
 * {@link extractAuthenticity} picks (aligned first, else the first mismatch),
 * matching the standing model's registrable-domain key.
 */
export const deriveStandingPair = (
	parsed: ParsedMail,
): StandingPairKeys | null => {
	const address = readableFromAddress(parsed);
	if (address === null) return null;

	const authenticity = extractAuthenticity(parsed);
	if (authenticity !== null) {
		const signer = authenticity.dkimDomain ?? UNVERIFIED_SIGNER_DOMAIN;
		return {
			senderKey: authenticity.fromDomain,
			signerDomain: getDomain(signer) ?? signer,
		};
	}

	return {
		senderKey: address.toLowerCase(),
		signerDomain: UNVERIFIED_SIGNER_DOMAIN,
	};
};

/**
 * Whether the sender is known to the account: the applicable
 * `(senderKey, signerDomain)` pair already has standing, or the user has
 * trusted the address outright. Either one is enough — a user-trusted address
 * with an ESP's signature is the ordinary shape of bulk mail the user asked
 * for, exactly what a pair with earned standing records.
 */
export const senderTrusted = (
	senderStanding: SenderSignerStandingItem | null | undefined,
	flags: AddressItem["flags"] | undefined,
): boolean => senderStanding != null || flags?.trusted?.value === true;

/**
 * The display-name results that say the name does not belong to the domain it
 * is shown over: unrelated, an edit-distance imitation of a domain label, or
 * a spelled-out address at some other registrable domain. `NoClaim` and
 * `Corresponds` are the honest outcomes and say nothing.
 */
const NON_CORRESPONDENCE: ReadonlySet<CorrespondenceValue> = new Set([
	DisplayNameCorrespondence.Unrelated,
	DisplayNameCorrespondence.Lookalike,
	DisplayNameCorrespondence.ForeignAddress,
]);

/**
 * The registrable domain of the envelope sender, from the Return-Path header
 * — the address the SMTP transaction actually came from, as recorded by the
 * receiving system. `null` when the header is absent or holds no address
 * (including the null sender `<>`), meaning the envelope could not be
 * compared at all.
 */
const envelopeFromDomain = (parsed: ParsedMail): string | null => {
	const line = parsed.headerLines.find(
		(l) => l.key.toLowerCase() === "return-path",
	);
	if (!line) return null;
	const text = line.line.slice(line.line.indexOf(":") + 1);
	const address =
		/<([^>]*)>/.exec(text)?.[1] ??
		/([^\s<>@,;:"]+@[^\s<>@,;:"]+)/.exec(text)?.[1];
	if (!address) return null;
	const at = address.lastIndexOf("@");
	if (at <= 0 || at === address.length - 1) return null;
	return address.slice(at + 1).toLowerCase();
};

/**
 * Registrable-domain alignment, the DMARC "relaxed" comparison: `mail.example.com`
 * and `example.com` align, and so do two different subdomains of the same
 * registrable domain.
 */
const domainsAlign = (left: string, right: string): boolean =>
	(getDomain(left) ?? left) === (getDomain(right) ?? right);

/**
 * Tier 1 — a positive impersonation signal, checked before anything that
 * could excuse the message:
 *
 * - a From address that is missing or unparseable — the one field the
 *   recipient reads names nobody;
 * - a DMARC `fail` in the Authentication-Results header, which the derivation
 *   reads as trusted (it is the receiving provider's own verdict, not a
 *   client-side guess);
 * - a display name that does not correspond to the From domain, or body links
 *   that leave it — both via {@link extractSenderMismatch}, so both stay
 *   gated on the provider's own spam verdict exactly as body-sync gates them:
 *   ordinary mail never reaches these aggressive comparisons.
 */
const isImpersonation = (parsed: ParsedMail): boolean => {
	const address = readableFromAddress(parsed);
	if (address === null) return true;

	if (extractAuthResult(parsed)?.dmarc === AuthResultVerdict.Fail) return true;

	const fromDomain = domainOfAddress(address);

	const signals = extractSenderMismatch(parsed, {
		fromDomain,
		spamClassified: extractProviderSpam(parsed)?.classified === true,
		bulkSender: extractHasListUnsubscribe(parsed),
	});

	if (
		signals.displayNameCorrespondence !== undefined &&
		NON_CORRESPONDENCE.has(signals.displayNameCorrespondence)
	) {
		return true;
	}

	return (signals.offDomainLinkDomains?.length ?? 0) > 0;
};

/**
 * Tier 3 — SPF passed in the trusted Authentication-Results and the
 * envelope-from domain (Return-Path) aligns with the From domain. Reaching
 * this rule already means no DKIM identity aligned with the From domain, so
 * this is the "verified by the envelope alone" verdict.
 */
const isAuthenticatedByEnvelope = (parsed: ParsedMail): boolean => {
	if (extractAuthResult(parsed)?.spf !== AuthResultVerdict.Pass) return false;

	const address = readableFromAddress(parsed);
	if (address === null) return false;
	const envelope = envelopeFromDomain(parsed);
	if (envelope === null) return false;

	return domainsAlign(envelope, domainOfAddress(address));
};

/**
 * Derive the sender-authenticity tier for one parsed message
 * (`Message.authenticityVerdict`, issue #1197). Pure function over the parsed
 * mail, the standing of the applicable pair, and the sender's address flags —
 * the caller does the repository reads, so the rule table stays testable
 * without fakes.
 *
 * First match wins, in the order the `AuthenticityVerdict` typespec fixes:
 *
 * 1. `Impersonation` — unreadable From address, DMARC failure in the trusted
 *    Authentication-Results, a display name that does not correspond to the
 *    From domain, or off-domain body links (the last two only on mail the
 *    provider already called spam — see {@link isImpersonation}).
 * 2. `Aligned` — a DKIM-Signature domain aligns with the From domain
 *    (`extractAuthenticity` → `dkimMismatch === false`).
 * 3. `Authenticated` — SPF passed and the envelope-from domain aligns with
 *    the From domain.
 * 4. `Routine` — a DKIM signature exists but none aligns, and the sender is
 *    trusted (the pair has standing, or the address flags say so): a third
 *    party signs for this sender as a matter of record.
 * 5. `NotChecked` — no DKIM signature at all, and the sender is trusted: the
 *    address-keyed pseudo-pair has standing, so silence is earned by prior
 *    observation.
 * 6. `Caution` — nothing verified aligned and the sender is unknown.
 *
 * `NotEvaluated` is never returned: it is the sentinel for "the derivation
 * has not run", not a result, and the only writer of this field is a path that
 * has run it.
 */
export const resolveAuthenticityVerdict = (
	parsed: ParsedMail,
	senderStanding: SenderSignerStandingItem | null,
	flags: AddressItem["flags"] | undefined,
): AuthenticityVerdictValue => {
	if (isImpersonation(parsed)) return AuthenticityVerdict.Impersonation;

	const authenticity = extractAuthenticity(parsed);

	if (authenticity?.dkimMismatch === false) return AuthenticityVerdict.Aligned;

	if (isAuthenticatedByEnvelope(parsed))
		return AuthenticityVerdict.Authenticated;

	if (
		authenticity?.dkimMismatch === true &&
		senderTrusted(senderStanding, flags)
	) {
		return AuthenticityVerdict.Routine;
	}

	if (authenticity === null && senderTrusted(senderStanding, flags)) {
		return AuthenticityVerdict.NotChecked;
	}

	return AuthenticityVerdict.Caution;
};
