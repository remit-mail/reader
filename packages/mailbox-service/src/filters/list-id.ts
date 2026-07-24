import type { ParsedMail } from "mailparser";

/**
 * Canonical form of a `List-Id` value for exact comparison: the bracketed
 * identifier when the header carries the RFC 2919 `Name <list.id>` shape,
 * otherwise the whole value, trimmed and case-folded. Both the stored copy and
 * a `ListId` clause pass through this, so `<weekly.news.example.com>` and
 * `weekly.news.example.com` are one list. An empty input normalizes to `""`.
 */
export const normalizeListId = (value: string): string => {
	const trimmed = value.trim();
	const bracketed = trimmed.match(/<([^>]+)>/);
	return (bracketed ? bracketed[1] : trimmed).trim().toLowerCase();
};

/**
 * The normalized `List-Id` header value of a parsed message, or `""` when the
 * message carries no `List-Id`. Read from the raw header line so the exact
 * value survives regardless of how the parser structures the header.
 */
export const extractListId = (parsed: ParsedMail): string => {
	const line = parsed.headerLines.find(
		(header) => header.key.toLowerCase() === "list-id",
	);
	if (!line) return "";
	const colon = line.line.indexOf(":");
	if (colon < 0) return "";
	return normalizeListId(line.line.slice(colon + 1));
};
