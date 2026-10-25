/**
 * Snippet generation utilities for email threading.
 *
 * Extracts preview text from email bodies by removing quoted content
 * and normalizing whitespace.
 */

import {
	createTextNormalizer,
	type SupportedLanguage,
} from "./text/normalizer.js";

/**
 * Remove quoted reply content from email body.
 *
 * Stops at common quote indicators:
 * - Lines starting with ">"
 * - "On ... wrote:" patterns
 * - "--- Original Message ---" separators
 * - Outlook-style underline separators
 */
export const removeQuotedContent = (text: string): string => {
	const lines = text.split("\n");
	const result: string[] = [];

	for (const line of lines) {
		// Stop at quote indicators
		if (/^>/.test(line)) break;
		if (/^On .+ wrote:$/i.test(line)) break;
		if (/^-{3,}\s*Original Message\s*-{3,}$/i.test(line)) break;
		if (/^_{3,}$/.test(line)) break; // Outlook separator
		if (/^From:.*Sent:.*To:/i.test(line)) break; // Outlook forward header

		result.push(line);
	}

	return result.join("\n");
};

const normalizer = createTextNormalizer();

/**
 * Normalize subject for thread grouping and search.
 *
 * Processing steps:
 * 1. Remove Re:/Fwd:/etc prefixes (multi-language support)
 * 2. Auto-detect language or use provided language
 * 3. Normalize with stemming and stopword removal
 * 4. Deduplicate consecutive words
 *
 * Handles common prefixes across languages:
 * - Re, Fwd, Fw (English)
 * - Aw, Sv, Vs (German, Swedish, Danish)
 * - Ref, Rif (Italian, Spanish)
 * - Odp (Polish)
 * - Ynt (Turkish)
 * - Antw (Dutch)
 * - Res (Portuguese)
 *
 * @param subject - The email subject line
 * @param language - Optional language override (auto-detected if not provided)
 */
export const normalizeSubject = (
	subject: string,
	language?: SupportedLanguage,
): string => {
	const SUBJECT_PREFIX_PATTERN =
		/^(\s*(Re|Fwd|Fw|Aw|Sv|Vs|Ref|Rif|Odp|Ynt|Antw|Res)(\[\d+\])?:\s*)+/i;

	// Step 1: Remove prefixes
	const withoutPrefix = subject.replace(SUBJECT_PREFIX_PATTERN, "").trim();

	// Step 2: Auto-detect language if not provided
	const detectedLanguage = language ?? normalizer.detectLanguage(withoutPrefix);

	// Step 3: Normalize with stemming and stopword removal
	return normalizer.normalize(withoutPrefix, {
		language: detectedLanguage,
		stem: true,
		removeStopwords: true,
	});
};

const flattenBody = (text: string): string =>
	removeQuotedContent(text).replace(/\s+/g, " ").trim();

/**
 * Generate a snippet from email text content.
 *
 * @param text - The text content (plain text or stripped HTML)
 * @param maxLength - Maximum snippet length (default 256)
 * @returns Truncated snippet with ellipsis if needed
 */
export const generateSnippet = (text: string, maxLength = 256): string => {
	const normalized = flattenBody(text);

	if (normalized.length <= maxLength) {
		return normalized;
	}

	// Truncate at word boundary
	const truncated = normalized.slice(0, maxLength);
	const lastSpace = truncated.lastIndexOf(" ");

	// If no space found, just truncate
	if (lastSpace === -1) {
		return `${truncated.slice(0, maxLength - 1)}...`;
	}

	// Truncate at word boundary and add ellipsis
	return `${truncated.slice(0, lastSpace)}...`;
};

/**
 * The body text the search index matches: the snippet's quote-stripped,
 * whitespace-collapsed text, cut back to the last word boundary at or under
 * `maxLength`, with no ellipsis. A first word longer than `maxLength` is cut
 * at `maxLength`.
 */
export const generateSearchText = (text: string, maxLength: number): string => {
	const normalized = flattenBody(text);
	if (normalized.length <= maxLength) return normalized;
	const boundary = normalized.lastIndexOf(" ", maxLength);
	return normalized.slice(0, boundary > 0 ? boundary : maxLength);
};

/**
 * The plain text of a parsed email: the text part when there is one, else the
 * HTML part with its tags stripped, else empty.
 */
const emailPlainText = (
	textContent: string | undefined,
	htmlContent: string | undefined,
): string => {
	if (textContent) return textContent;
	if (!htmlContent) return "";
	// Basic HTML tag stripping - for more robust handling, use html-to-text
	return htmlContent
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"');
};

/**
 * Extract text content from parsed email for snippet generation.
 *
 * Prefers plain text over HTML, stripping the HTML's tags when it is the only
 * part.
 *
 * @param textContent - Plain text content (may be undefined)
 * @param htmlContent - HTML content (may be undefined)
 * @param maxLength - Maximum snippet length
 * @returns Generated snippet or empty string
 */
export const extractSnippetFromEmail = (
	textContent: string | undefined,
	htmlContent: string | undefined,
	maxLength = 256,
): string =>
	generateSnippet(emailPlainText(textContent, htmlContent), maxLength);

/** The search text of a parsed email, from the same part the snippet reads. */
export const extractSearchTextFromEmail = (
	textContent: string | undefined,
	htmlContent: string | undefined,
	maxLength: number,
): string =>
	generateSearchText(emailPlainText(textContent, htmlContent), maxLength);
