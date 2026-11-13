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
	isPunycode,
	looksGenerated,
	skeleton,
} from "./domains.js";
import {
	type HeaderAddress,
	headerValue,
	parseAddressHeader,
} from "./headers.js";

type ReasonName = (typeof SpamReasonName)[keyof typeof SpamReasonName];

/** One check that found something, before its weight is attached. */
export interface Finding {
	name: ReasonName;
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

/** Check 1. */
export const dmarcFails = ({ request }: CheckInput): Finding[] =>
	request.authentication.dmarc === AuthResultVerdict.Fail
		? [{ name: SpamReasonName.DmarcFail, options: [] }]
		: [];

/** Check 2. */
export const replyToDiffers = (input: CheckInput): Finding[] => {
	const replyTo = parseAddressHeader(
		headerValue(input.request.message.headers, "Reply-To"),
	);
	if (!replyTo || !input.senderDomain) return [];
	const replyDomain = registrable(input.tldts, replyTo.domain);
	if (!replyDomain || replyDomain === input.senderDomain) return [];
	return [{ name: SpamReasonName.ReplyToMismatch, options: [replyDomain] }];
};

/** Check 3: link-gated. */
export const linkTextDiffers = (input: CheckInput): Finding[] => {
	const found = input.links.flatMap((link) => {
		const shown = DOMAIN_IN_TEXT.exec(link.text)?.[1];
		if (!shown) return [];
		const shownDomain = registrable(input.tldts, shown);
		if (!shownDomain || shownDomain === link.hrefDomain) return [];
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

/** Check 5: punycode, mixed scripts, and two domains with one skeleton. */
export const confusableDomains = (input: CheckInput): Finding[] => {
	const hosts = domainsInMessage(input);
	const findings: Finding[] = [];
	const punycode = hosts.filter(isPunycode);
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
	const againstSender = classifyDisplayNameCorrespondence(
		from.name,
		from.domain,
		tldts,
	);
	if (againstSender === DisplayNameCorrespondence.ForeignAddress) {
		return [
			{ name: SpamReasonName.DisplayNameForeignAddress, options: [from.name] },
		];
	}
	const lookalikeOf = [
		from.domain,
		...input.links.map((link) => link.hrefDomain),
	].find(
		(domain) =>
			classifyDisplayNameCorrespondence(from.name, domain, tldts) ===
			DisplayNameCorrespondence.Lookalike,
	);
	return lookalikeOf
		? [
				{
					name: SpamReasonName.DisplayNameLookalike,
					options: [from.name, lookalikeOf],
				},
			]
		: [];
};

const ALWAYS = [
	dmarcFails,
	replyToDiffers,
	confusableDomains,
	generatedName,
	domainHistory,
	classifierAnswer,
	providerCallsSpam,
	displayNameClaims,
];

const LINK_CHECKS = [linkTextDiffers, linksLeaveFar, singleOffDomainLink];

/** Every check that found something. Link checks count only for a sender with no earlier mail. */
export const runChecks = (input: CheckInput): Finding[] => {
	const checks =
		input.request.context.senderMessagesSeen === 0
			? [...ALWAYS, ...LINK_CHECKS]
			: ALWAYS;
	return checks.flatMap((check) => check(input));
};
