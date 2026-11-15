import type { SpamRequest } from "@remit/data-ports";
import {
	AuthResultVerdict,
	ClassificationLabel,
	DisplayNameCorrespondence,
	ProviderSpamVerdict,
	SpamReasonName,
} from "@remit/domain-enums";
import {
	classifyDisplayNameCorrespondence,
	editDistance,
	type Tldts,
} from "./display-name.js";
import {
	hasMixedScriptLabel,
	imitatesAscii,
	isPunycode,
	looksGenerated,
	skeleton,
} from "./domains.js";
import {
	type HeaderAddress,
	headerValue,
	parseAddressHeader,
} from "./headers.js";

/** A reason stage 2 finds itself; `BackendSymbol` is only ever a backend's, and `Model*` stage 3's. */
export type CheckName = Exclude<
	(typeof SpamReasonName)[keyof typeof SpamReasonName],
	"BackendSymbol" | "ListedPhishingLink" | `Model${string}`
>;

/** One check that found something, before its weight is attached. */
export interface Finding {
	name: CheckName;
	options: string[];
}

/** What every check reads, parsed once from the request. */
export interface CheckInput {
	request: SpamRequest;
	tldts: Tldts;
	from: HeaderAddress | undefined;
	senderDomain: string | undefined;
	links: { href: string; hrefDomain: string; text: string }[];
}

const MAX_OPTIONS = 10;
const UNVERIFIED = "unverified";
const RECENT_REGISTRATION_MS = 90 * 24 * 60 * 60 * 1000;
const DOMAIN_IN_TEXT =
	/(?:^|[^\p{L}\p{N}.-])((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?![\p{L}\p{N}-])/iu;

const registrable = (tldts: Tldts, host: string): string | undefined =>
	tldts.getDomain(host, { allowPrivateDomains: false }) ?? undefined;

const unique = (values: string[]): string[] =>
	[...new Set(values)].slice(0, MAX_OPTIONS);

export const toCheckInput = (
	request: SpamRequest,
	tldts: Tldts,
): CheckInput => {
	const from = parseAddressHeader(headerValue(request.message.headers, "From"));
	const links = request.message.links.flatMap((link) => {
		if (!/^https?:\/\//i.test(link.href)) return [];
		const hrefDomain = registrable(tldts, link.href);
		return hrefDomain ? [{ ...link, hrefDomain }] : [];
	});
	return {
		request,
		tldts,
		from,
		senderDomain: from ? registrable(tldts, from.domain) : undefined,
		links,
	};
};

const DKIM_SIGNER = /(?:^|;)\s*d\s*=\s*([^;\s]+)/i;

const aligned = (signer: string, fromDomain: string): boolean =>
	signer === fromDomain ||
	fromDomain.endsWith(`.${signer}`) ||
	signer.endsWith(`.${fromDomain}`);

const signers = (input: CheckInput): string[] =>
	input.request.message.headers.flatMap((header) => {
		if (header.name.toLowerCase() !== "dkim-signature") return [];
		const signer = DKIM_SIGNER.exec(header.value)?.[1];
		return signer ? [signer.toLowerCase()] : [];
	});

const signaturesMisaligned = (input: CheckInput): boolean => {
	const fromDomain = input.from?.domain;
	if (!fromDomain) return false;
	const found = signers(input);
	return (
		found.length > 0 && !found.some((signer) => aligned(signer, fromDomain))
	);
};

const LIST_ID = /<([^<>\s]+)>/;

const hasHeader = (input: CheckInput, name: string): boolean =>
	headerValue(input.request.message.headers, name) !== undefined;

const listIdDomain = (input: CheckInput): string | undefined => {
	const value = headerValue(input.request.message.headers, "List-Id");
	if (value === undefined) return undefined;
	const id = LIST_ID.exec(value)?.[1] ?? value.trim();
	return registrable(input.tldts, id);
};

const RESULT_SEGMENT = /^\s*([a-z]+)\s*=\s*([a-z]+)\b(.*)$/is;
const HEADER_D = /\bheader\.d\s*=\s*([^\s;]+)/i;

const authResults = (
	input: CheckInput,
	method: string,
): { result: string; signer: string | undefined }[] =>
	input.request.message.headers.flatMap((header) => {
		if (header.name.toLowerCase() !== "authentication-results") return [];
		return header.value.split(";").flatMap((segment) => {
			const match = RESULT_SEGMENT.exec(segment);
			if (match?.[1].toLowerCase() !== method) return [];
			return [
				{
					result: match[2].toLowerCase(),
					signer: HEADER_D.exec(match[3])?.[1].toLowerCase(),
				},
			];
		});
	});

const allPass = (results: readonly { result: string }[]): boolean =>
	results.length > 0 && results.every(({ result }) => result === "pass");

/**
 * A mailing list or forwarder resent the message, and the receiver verified
 * the relay: an ARC chain, or a signature of the list named in List-Id. Every
 * result must pass, so a forged passing result cannot outvote the receiver's.
 * A relay breaks the author's DKIM and with it DMARC, so neither then says the
 * From is forged.
 */
const relayed = (input: CheckInput): boolean => {
	if (hasHeader(input, "ARC-Seal") && allPass(authResults(input, "arc"))) {
		return true;
	}
	const list = listIdDomain(input);
	if (list === undefined) return false;
	const ofList = (signer: string | undefined): boolean =>
		signer !== undefined && registrable(input.tldts, signer) === list;
	return (
		signers(input).some(ofList) &&
		allPass(authResults(input, "dkim").filter(({ signer }) => ofList(signer)))
	);
};

/** Bulk mail whose From domain passes DMARC: trackers and a separate Reply-To are how it is sent. */
const authenticatedBulk = (input: CheckInput): boolean =>
	input.request.authentication.dmarc === AuthResultVerdict.Pass &&
	(hasHeader(input, "List-Unsubscribe") || hasHeader(input, "List-Id"));

/**
 * Check 1: DMARC failed, or a signature belongs to another domain. DMARC
 * already weighs signature alignment, so a foreign signer counts only where
 * DMARC gave no verdict.
 */
export const authenticationFails = (input: CheckInput): Finding[] => {
	if (relayed(input)) return [];
	const { authentication } = input.request;
	const findings: Finding[] = [];
	const dmarcFailed = authentication.dmarc === AuthResultVerdict.Fail;
	const dmarcDecided =
		dmarcFailed || authentication.dmarc === AuthResultVerdict.Pass;
	const signer = authentication.signerDomain;
	const signerMismatch =
		!dmarcDecided &&
		signer !== UNVERIFIED &&
		input.senderDomain !== undefined &&
		registrable(input.tldts, signer) !== input.senderDomain;
	if (dmarcFailed) {
		findings.push({ name: SpamReasonName.DmarcFail, options: [] });
	}
	if (
		dmarcFailed &&
		(authentication.dkim === AuthResultVerdict.Fail ||
			signaturesMisaligned(input))
	) {
		findings.push({ name: SpamReasonName.DkimDmarcFail, options: [] });
	}
	if (signerMismatch) {
		findings.push({ name: SpamReasonName.SignerMismatch, options: [signer] });
	}
	return findings;
};

/** Check 2: authenticated bulk mail and lists answer elsewhere by design. */
export const replyToDiffers = (input: CheckInput): Finding[] => {
	if (authenticatedBulk(input) || relayed(input)) return [];
	const replyTo = parseAddressHeader(
		headerValue(input.request.message.headers, "Reply-To"),
	);
	if (!replyTo || !input.senderDomain) return [];
	const replyDomain = registrable(input.tldts, replyTo.domain);
	if (!replyDomain || replyDomain === input.senderDomain) return [];
	return [{ name: SpamReasonName.ReplyToMismatch, options: [replyDomain] }];
};

const SHOWN_ADDRESS =
	/^(https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})\.?([/:?#]\S*)?$/iu;

/**
 * The domain a link's text presents as its destination: the whole text is an
 * address, and it reads as one — a scheme, `www.`, a path, or a public
 * suffix. `Node.js` in a headline names a project, not a host.
 */
const shownDomainOf = (tldts: Tldts, text: string): string | undefined => {
	const match = SHOWN_ADDRESS.exec(text.trim());
	if (!match) return undefined;
	const [, scheme, host, path] = match;
	const looksLikeAddress =
		scheme !== undefined ||
		path !== undefined ||
		/^www\./i.test(host) ||
		tldts.parse(host).isIcann === true;
	return looksLikeAddress ? registrable(tldts, host) : undefined;
};

/**
 * Check 3: link-gated. A sender that passes DMARC showing its own domain over
 * a click tracker names itself, not someone else.
 */
export const linkTextDiffers = (input: CheckInput): Finding[] => {
	const ownDomain =
		input.request.authentication.dmarc === AuthResultVerdict.Pass
			? input.senderDomain
			: undefined;
	const found = input.links.flatMap((link) => {
		const shownDomain = shownDomainOf(input.tldts, link.text);
		if (!shownDomain || shownDomain === link.hrefDomain) return [];
		if (shownDomain === ownDomain) return [];
		return [`${shownDomain} -> ${link.hrefDomain}`];
	});
	return found.length > 0
		? [{ name: SpamReasonName.LinkTextMismatch, options: unique(found) }]
		: [];
};

const labelOf = (tldts: Tldts, domain: string): string =>
	tldts.getDomainWithoutSuffix(domain) ?? domain;

/** Check 4: link-gated. */
export const linksLeaveFar = (input: CheckInput): Finding[] => {
	const { senderDomain, tldts } = input;
	if (!senderDomain) return [];
	const senderLabel = labelOf(tldts, senderDomain);
	const far = input.links
		.map((link) => link.hrefDomain)
		.filter((domain) => {
			if (domain === senderDomain) return false;
			const label = labelOf(tldts, domain);
			const distance = editDistance(senderLabel, label);
			return distance / Math.max(senderLabel.length, label.length) > 0.5;
		});
	return far.length > 0
		? [{ name: SpamReasonName.LinkDomainDistant, options: unique(far) }]
		: [];
};

const domainsInMessage = (input: CheckInput): string[] => {
	const { request, tldts } = input;
	const hosts = [
		input.from?.domain,
		parseAddressHeader(headerValue(request.message.headers, "Reply-To"))
			?.domain,
		...input.links.map((link) => tldts.getHostname(link.href) ?? undefined),
		...input.links.map((link) => DOMAIN_IN_TEXT.exec(link.text)?.[1]),
	];
	return [
		...new Set(
			hosts
				.filter((host): host is string => !!host)
				.map((h) => h.toLowerCase()),
		),
	];
};

/**
 * Check 5: punycode that reads as an ASCII domain, mixed scripts, and two
 * domains with one skeleton. `café.nl` is an honest name; `аpple.com` is not.
 */
export const confusableDomains = (input: CheckInput): Finding[] => {
	const hosts = domainsInMessage(input);
	const findings: Finding[] = [];
	const punycode = hosts.filter(
		(host) => isPunycode(host) && imitatesAscii(host),
	);
	if (punycode.length > 0) {
		findings.push({
			name: SpamReasonName.PunycodeDomain,
			options: unique(punycode),
		});
	}
	const mixed = hosts.filter(hasMixedScriptLabel);
	if (mixed.length > 0) {
		findings.push({
			name: SpamReasonName.MixedScriptDomain,
			options: unique(mixed),
		});
	}
	const bySkeleton = new Map<string, Set<string>>();
	for (const host of hosts) {
		const domain = registrable(input.tldts, host);
		if (!domain) continue;
		const key = skeleton(domain);
		bySkeleton.set(key, (bySkeleton.get(key) ?? new Set()).add(domain));
	}
	const collisions = [...bySkeleton.values()]
		.filter((domains) => domains.size > 1)
		.flatMap((domains) => [...domains]);
	if (collisions.length > 0) {
		findings.push({
			name: SpamReasonName.ConfusableDomains,
			options: unique(collisions),
		});
	}
	return findings;
};

/** Check 6: link-gated. */
export const singleOffDomainLink = (input: CheckInput): Finding[] => {
	if (input.request.message.html.trim() === "") return [];
	const hrefs = new Set(input.links.map((link) => link.href));
	if (hrefs.size !== 1) return [];
	const [link] = input.links;
	if (link.hrefDomain === input.senderDomain) return [];
	return [
		{ name: SpamReasonName.SingleOffDomainLink, options: [link.hrefDomain] },
	];
};

/** Check 7. */
export const generatedName = (input: CheckInput): Finding[] => {
	const { from, senderDomain, tldts } = input;
	if (!from) return [];
	const localPart = from.address.split("@")[0];
	const names = [
		localPart,
		senderDomain ? labelOf(tldts, senderDomain) : undefined,
	].filter(
		(name): name is string => name !== undefined && looksGenerated(name),
	);
	return names.length > 0
		? [{ name: SpamReasonName.GeneratedName, options: names }]
		: [];
};

/** Check 8. */
export const domainHistory = ({
	request,
	senderDomain,
}: CheckInput): Finding[] => {
	const { context } = request;
	const domain = senderDomain ? [senderDomain] : [];
	const findings: Finding[] = [];
	if (context.senderDomainMessagesSeen === 0) {
		findings.push({ name: SpamReasonName.FirstContactDomain, options: domain });
	}
	if (context.senderDomainRegisteredAt === undefined) {
		if (context.senderDomainMessagesSeen === 0) {
			findings.push({
				name: SpamReasonName.UnknownRegistrationDate,
				options: domain,
			});
		}
		return findings;
	}
	const age =
		Date.parse(context.receivedAt) -
		Date.parse(context.senderDomainRegisteredAt);
	if (age < RECENT_REGISTRATION_MS) {
		findings.push({
			name: SpamReasonName.RecentlyRegisteredDomain,
			options: [...domain, context.senderDomainRegisteredAt],
		});
	}
	return findings;
};

/** Check 9. */
export const classifierAnswer = ({ request }: CheckInput): Finding[] =>
	request.context.classifierScores.flatMap((score): Finding[] => {
		if (!score.confident) return [];
		if (score.label === ClassificationLabel.Spam) {
			return [{ name: SpamReasonName.ClassifierSpam, options: [] }];
		}
		if (score.label === ClassificationLabel.Phishing) {
			return [{ name: SpamReasonName.ClassifierPhishing, options: [] }];
		}
		return [];
	});

/** Check 10. */
export const providerCallsSpam = ({ request }: CheckInput): Finding[] =>
	request.provider.verdict === ProviderSpamVerdict.Spam
		? [
				{
					name: SpamReasonName.ProviderSpam,
					options: request.provider.score ? [request.provider.score] : [],
				},
			]
		: [];

/** Check 11: the display name claims an address or a lookalike of a domain. */
export const displayNameClaims = (input: CheckInput): Finding[] => {
	const { from, tldts } = input;
	if (!from || from.name === "") return [];
	const correspondence = classifyDisplayNameCorrespondence(
		from.name,
		from.domain,
		tldts,
		input.links.map((link) => link.hrefDomain),
	);
	if (correspondence === DisplayNameCorrespondence.ForeignAddress) {
		return [
			{ name: SpamReasonName.DisplayNameForeignAddress, options: [from.name] },
		];
	}
	if (correspondence === DisplayNameCorrespondence.Lookalike) {
		return [
			{ name: SpamReasonName.DisplayNameLookalike, options: [from.name] },
		];
	}
	return [];
};

const ALWAYS = [
	authenticationFails,
	replyToDiffers,
	confusableDomains,
	generatedName,
	domainHistory,
	classifierAnswer,
	providerCallsSpam,
	displayNameClaims,
];

const TRACKED_LINK_CHECKS = [linksLeaveFar, singleOffDomainLink];

/**
 * Every check that found something. Link checks count only for a sender with
 * no earlier mail, and authenticated bulk mail sends every link through a
 * click tracker on another domain, so there only the link text counts.
 */
const linkChecksFor = (input: CheckInput) => {
	if (input.request.context.senderMessagesSeen !== 0) return [];
	if (authenticatedBulk(input)) return [linkTextDiffers];
	return [linkTextDiffers, ...TRACKED_LINK_CHECKS];
};

export const runChecks = (input: CheckInput): Finding[] =>
	[...ALWAYS, ...linkChecksFor(input)].flatMap((check) => check(input));
