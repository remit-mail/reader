import type { SpamRequest } from "@remit/data-ports";

type SpamLink = SpamRequest["message"]["links"][number];

const MAX_LINKS = 100;

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
