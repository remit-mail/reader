/**
 * Snippet generation utilities for email threading.
 *
 * Extracts preview text from email bodies by removing quoted content
 * and normalizing whitespace.
 */

import type { ParsedMail } from "mailparser";

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

const SEARCH_TEXT_LENGTH = 524288;

export const extractSearchText = (
	parsed: Pick<ParsedMail, "text" | "html">,
): string => {
	const text = flattenBody(
		emailPlainText(
			parsed.text,
			typeof parsed.html === "string" ? parsed.html : undefined,
		),
	);
	if (text.length <= SEARCH_TEXT_LENGTH) return text;
	const boundary = text.lastIndexOf(" ", SEARCH_TEXT_LENGTH);
	return text.slice(0, boundary > 0 ? boundary : SEARCH_TEXT_LENGTH);
};
