import type { ClassifierScoreItem, SpamRequest } from "@remit/data-ports";
import { AuthResultVerdict, ProviderSpamVerdict } from "@remit/domain-enums";
import type { HeaderValue, ParsedMail } from "mailparser";
import { isProviderSpamHeader } from "../classifier/classifier-gate.js";
import {
	extractAuthResult,
	extractProviderSpam,
} from "../heuristics/classifyByHeaders.js";
import type { Tldts } from "./display-name.js";
import { linksOf } from "./links.js";

type SpamHeader = SpamRequest["message"]["headers"][number];

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

const UNVERIFIED = "unverified";

const rawValue = (line: string): string =>
	line
		.slice(line.indexOf(":") + 1)
		.replace(/\r?\n[ \t]+/g, " ")
		.trim();

const decodedValue = (
	value: HeaderValue,
	index: number,
): string | undefined => {
	const item = Array.isArray(value) ? value[index] : value;
	if (typeof item === "string") return item;
	if (typeof item === "object" && item !== null && "text" in item) {
		return typeof item.text === "string" ? item.text : undefined;
	}
	return undefined;
};

/**
 * Every header line in order, with the value mailparser decoded where it
 * decodes one (encoded words, address lists), and the unfolded raw value
 * where it parses the header into a structure instead.
 */
const headersOf = (parsed: ParsedMail): SpamHeader[] => {
	const seen = new Map<string, number>();
	return parsed.headerLines.map(({ key, line }) => {
		const index = seen.get(key) ?? 0;
		seen.set(key, index + 1);
		const value = parsed.headers.get(key);
		const decoded =
			value === undefined ? undefined : decodedValue(value, index);
		return {
			name: line.slice(0, line.indexOf(":")).trim(),
			value: decoded ?? rawValue(line),
		};
	});
};

const header = (headers: readonly SpamHeader[], name: string) =>
	headers.find((entry) => entry.name.toLowerCase() === name);

const RECEIVED_HELO = /^from\s+(\S+)/i;
const RECEIVED_IP = /\[(?:ipv6:)?([0-9a-f.:]+)\]/i;

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
			signerDomain: auth?.signerDomain
				? (tldts.getDomain(auth.signerDomain) ?? auth.signerDomain)
				: UNVERIFIED,
			envelopeDomain: auth?.envelopeDomain ?? "",
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
