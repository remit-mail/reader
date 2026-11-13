import type { ClassifierScoreItem, SpamRequest } from "@remit/data-ports";
import { AuthResultVerdict, ProviderSpamVerdict } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { isProviderSpamHeader } from "../classifier/classifier-gate.js";
import { parseAuthenticationResults } from "../heuristics/authenticationResults.js";
import {
	extractAuthResult,
	extractProviderSpam,
} from "../heuristics/classifyByHeaders.js";
import type { Tldts } from "./display-name.js";

type SpamHeader = SpamRequest["message"]["headers"][number];
type SpamLink = SpamRequest["message"]["links"][number];

/** What Remit knows beyond the message itself. */
export interface SpamFacts {
	rcpt: string[];
	receivedAt: number;
	knownSender: boolean;
	senderMessagesSeen: number;
	senderDomainMessagesSeen: number;
	senderDomainRegisteredAt: string | undefined;
	classifierScores: ClassifierScoreItem[];
	modelAllowed: boolean;
}

const MAX_LINKS = 100;
const UNVERIFIED = "unverified";

const headersOf = (parsed: ParsedMail): SpamHeader[] =>
	parsed.headerLines.map(({ line }) => {
		const colon = line.indexOf(":");
		return {
			name: line.slice(0, colon).trim(),
			value: line
				.slice(colon + 1)
				.replace(/\r?\n[ \t]+/g, " ")
				.trim(),
		};
	});

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

const visibleText = (html: string): string =>
	html
		.replace(/<[^>]*>/g, " ")
		.replace(/&(#\d{1,7}|[a-z]+);/gi, (entity, name: string) => {
			if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? entity;
			const codePoint = Number(name.slice(1));
			return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
		})
		.replace(/\s+/g, " ")
		.trim();

const ANCHOR =
	/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

/** Every anchor's href with the text the reader sees, then bare URLs in the text part. */
export const linksOf = (html: string, text: string): SpamLink[] => {
	const links: SpamLink[] = [];
	for (const match of html.matchAll(ANCHOR)) {
		links.push({
			href: (match[1] ?? match[2] ?? match[3] ?? "").trim(),
			text: visibleText(match[4]),
		});
	}
	const seen = new Set(links.map((link) => link.href));
	for (const url of text.match(URL_IN_TEXT) ?? []) {
		if (seen.has(url)) continue;
		seen.add(url);
		links.push({ href: url, text: url });
	}
	return links.slice(0, MAX_LINKS);
};

const header = (headers: readonly SpamHeader[], name: string) =>
	headers.find((entry) => entry.name.toLowerCase() === name);

const RECEIVED_HELO = /^from\s+(\S+)/i;
const RECEIVED_IP = /\[(?:ipv6:)?([0-9a-f.:]+)\]/i;

const authenticationIdentities = (
	headers: readonly SpamHeader[],
	tldts: Tldts,
): { signerDomain: string; envelopeDomain: string } => {
	const results = headers
		.filter((entry) => entry.name.toLowerCase() === "authentication-results")
		.map((entry) => parseAuthenticationResults(entry.value))
		.flatMap((parsed) => parsed?.results ?? []);
	const signer = results
		.find((result) => result.method === "dkim" && result.result === "pass")
		?.properties.get("header.d");
	const spf = results.find((result) => result.method === "spf");
	const mailFrom = spf?.properties.get("smtp.mailfrom");
	const envelope = mailFrom?.includes("@")
		? mailFrom.slice(mailFrom.lastIndexOf("@") + 1)
		: (mailFrom ?? spf?.properties.get("smtp.helo"));
	return {
		signerDomain: signer
			? (tldts.getDomain(signer) ?? signer.toLowerCase())
			: UNVERIFIED,
		envelopeDomain: envelope?.toLowerCase() ?? "",
	};
};

const providerVerdictOf = (parsed: ParsedMail) => {
	const provider = extractProviderSpam(parsed);
	if (provider === null)
		return { verdict: ProviderSpamVerdict.Absent, score: "" };
	return {
		verdict: provider.classified
			? ProviderSpamVerdict.Spam
			: ProviderSpamVerdict.Clean,
		score: provider.score ?? "",
	};
};

/**
 * The spam request for one message (RFC 041). Remit parses the message once
 * and sends the parts, so a backend needs no MIME parser.
 */
export const buildSpamRequest = (
	parsed: ParsedMail,
	raw: Buffer,
	facts: SpamFacts,
	tldts: Tldts,
): SpamRequest => {
	const headers = headersOf(parsed);
	const html = typeof parsed.html === "string" ? parsed.html : "";
	const text = parsed.text ?? "";
	const received = header(headers, "received")?.value ?? "";
	const returnPath = header(headers, "return-path")?.value ?? "";
	const auth = extractAuthResult(parsed);
	return {
		message: {
			raw: raw.toString("base64"),
			headers,
			text,
			html,
			links: linksOf(html, text),
		},
		envelope: {
			mailFrom: returnPath.replace(/[<>]/g, "").trim().toLowerCase(),
			rcpt: facts.rcpt,
			ip: RECEIVED_IP.exec(received)?.[1] ?? "",
			helo: RECEIVED_HELO.exec(received)?.[1] ?? "",
		},
		authentication: {
			dmarc: auth?.dmarc ?? AuthResultVerdict.None,
			spf: auth?.spf ?? AuthResultVerdict.None,
			dkim: auth?.dkim ?? AuthResultVerdict.None,
			...authenticationIdentities(headers, tldts),
		},
		provider: {
			...providerVerdictOf(parsed),
			headers: headers.filter((entry) => isProviderSpamHeader(entry.name)),
		},
		context: {
			knownSender: facts.knownSender,
			senderMessagesSeen: facts.senderMessagesSeen,
			senderDomainMessagesSeen: facts.senderDomainMessagesSeen,
			...(facts.senderDomainRegisteredAt !== undefined
				? { senderDomainRegisteredAt: facts.senderDomainRegisteredAt }
				: {}),
			receivedAt: new Date(facts.receivedAt).toISOString(),
			classifierScores: facts.classifierScores,
			modelAllowed: facts.modelAllowed,
		},
	};
};
