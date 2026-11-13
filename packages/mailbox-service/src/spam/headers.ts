import type { SpamRequest } from "@remit/data-ports";

type SpamHeader = SpamRequest["message"]["headers"][number];

export interface HeaderAddress {
	name: string;
	address: string;
	domain: string;
}

const ENCODED_WORD = /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi;
const BASE64 = /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i;

const decodeBytes = (charset: string, bytes: Uint8Array): string => {
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder("utf-8").decode(bytes);
	}
};

const qBytes = (text: string): Uint8Array => {
	const out: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === "_") {
			out.push(0x20);
			continue;
		}
		if (char === "=" && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
			out.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
			i += 2;
			continue;
		}
		out.push(char.charCodeAt(0));
	}
	return Uint8Array.from(out);
};

/** RFC 2047 encoded words decoded, so a display name reads as the reader sees it. */
export const decodeEncodedWords = (value: string): string =>
	value
		.replace(/\?=\s+=\?/g, "?==?")
		.replace(
			ENCODED_WORD,
			(word, charset: string, encoding: string, text: string) => {
				if (encoding.toLowerCase() === "q") {
					return decodeBytes(charset, qBytes(text));
				}
				if (!BASE64.test(text)) return word;
				return decodeBytes(
					charset,
					Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
				);
			},
		);

export const headerValue = (
	headers: readonly SpamHeader[],
	name: string,
): string | undefined =>
	headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
		?.value;

const ADDRESS = /([^\s<>"@,;:]+@([a-z0-9.-]+\.[a-z0-9-]+))/i;

/** The first mailbox of an address header: display name, address and domain. */
export const parseAddressHeader = (
	value: string | undefined,
): HeaderAddress | undefined => {
	if (value === undefined) return undefined;
	const decoded = decodeEncodedWords(value).trim();
	const angle = /^(.*)<([^<>]+)>\s*$/s.exec(decoded);
	const raw = angle ? angle[2] : decoded;
	const match = ADDRESS.exec(raw);
	if (!match) return undefined;
	const name = angle
		? angle[1]
				.trim()
				.replace(/^"(.*)"$/s, "$1")
				.trim()
		: "";
	return {
		name,
		address: match[1].toLowerCase(),
		domain: match[2].toLowerCase(),
	};
};
