import type { Chunk } from "../types.js";
import { EMBED_CHAR_BUDGET, splitToCharBudget } from "./entropy.js";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
const CURRENCY_RE =
	/(?:[€$£¥]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?(?:EUR|USD|GBP|JPY)\b)/g;
const PERCENT_RE = /\b\d{1,3}(?:[.,]\d+)?%/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const LONG_DATE_RE =
	/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/gi;
const QUARTER_RE = /\bQ[1-4]\s?\d{4}\b/g;

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

export interface ExtractedEntities {
	emails: string[];
	urls: string[];
	dates: string[];
	amounts: string[];
}

export const extractEntities = (text: string): ExtractedEntities => {
	const emails = dedupe(text.match(EMAIL_RE) ?? []);
	const urls = dedupe(text.match(URL_RE) ?? []);
	const dates = dedupe([
		...(text.match(ISO_DATE_RE) ?? []),
		...(text.match(LONG_DATE_RE) ?? []),
		...(text.match(QUARTER_RE) ?? []),
	]);
	const amounts = dedupe([
		...(text.match(CURRENCY_RE) ?? []),
		...(text.match(PERCENT_RE) ?? []),
	]);
	return { emails, urls, dates, amounts };
};

const formatEntities = (entities: ExtractedEntities): string => {
	const parts: string[] = [];
	if (entities.emails.length > 0) {
		parts.push(`Emails: ${entities.emails.join(", ")}`);
	}
	if (entities.urls.length > 0) {
		parts.push(`Links: ${entities.urls.join(", ")}`);
	}
	if (entities.dates.length > 0) {
		parts.push(`Dates: ${entities.dates.join(", ")}`);
	}
	if (entities.amounts.length > 0) {
		parts.push(`Amounts: ${entities.amounts.join(", ")}`);
	}
	return parts.join("\n");
};

export const buildEntityChunks = (
	text: string,
	chunkIdFor: (suffix: string) => string,
): Chunk[] => {
	const entities = extractEntities(text);
	const summary = formatEntities(entities);
	if (summary.length === 0) return [];
	const parts = splitToCharBudget(summary, EMBED_CHAR_BUDGET);
	return parts.map((part, idx) => ({
		chunkId: chunkIdFor(parts.length === 1 ? "entities" : `entities-${idx}`),
		chunkType: "entities",
		text: part,
	}));
};
