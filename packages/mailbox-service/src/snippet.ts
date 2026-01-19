/**
 * Snippet generation utilities for email threading.
 *
 * Extracts preview text from email bodies by removing quoted content
 * and normalizing whitespace.
 */

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

/**
 * Common stopwords to remove from normalized subjects.
 * Kept minimal to avoid removing meaningful words.
 */
const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"but",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"must",
	"shall",
	"can",
	"of",
	"at",
	"by",
	"for",
	"with",
	"about",
	"to",
	"from",
	"in",
	"on",
	"it",
	"its",
	"this",
	"that",
	"these",
	"those",
	"i",
	"you",
	"we",
	"they",
	"he",
	"she",
	"my",
	"your",
	"our",
	"their",
]);

/**
 * Normalize subject for thread grouping and search.
 *
 * Processing steps:
 * 1. Remove Re:/Fwd:/etc prefixes (multi-language support)
 * 2. Lowercase for case-insensitive matching
 * 3. Remove stopwords for better matching
 * 4. Deduplicate consecutive words
 * 5. Normalize whitespace
 *
 * Handles common prefixes across languages:
 * - Re, Fwd, Fw (English)
 * - Aw, Sv, Vs (German, Swedish, Danish)
 * - Ref, Rif (Italian, Spanish)
 * - Odp (Polish)
 * - Ynt (Turkish)
 * - Antw (Dutch)
 * - Res (Portuguese)
 */
export const normalizeSubject = (subject: string): string => {
	const SUBJECT_PREFIX_PATTERN =
		/^(\s*(Re|Fwd|Fw|Aw|Sv|Vs|Ref|Rif|Odp|Ynt|Antw|Res)(\[\d+\])?:\s*)+/i;

	// Step 1: Remove prefixes
	let normalized = subject.replace(SUBJECT_PREFIX_PATTERN, "").trim();

	// Step 2: Lowercase
	normalized = normalized.toLowerCase();

	// Step 3: Remove non-alphanumeric characters (keep spaces for word splitting)
	normalized = normalized.replace(/[^a-z0-9\s]/g, " ");

	// Step 4: Split into words, remove stopwords, dedupe consecutive words
	const words = normalized.split(/\s+/).filter((word) => word.length > 0);
	const result: string[] = [];

	for (const word of words) {
		// Skip stopwords
		if (STOPWORDS.has(word)) continue;

		// Skip consecutive duplicates
		if (result.length > 0 && result[result.length - 1] === word) continue;

		result.push(word);
	}

	return result.join(" ");
};

/**
 * Generate a snippet from email text content.
 *
 * @param text - The text content (plain text or stripped HTML)
 * @param maxLength - Maximum snippet length (default 256)
 * @returns Truncated snippet with ellipsis if needed
 */
export const generateSnippet = (text: string, maxLength = 256): string => {
	// Remove quoted content
	const unquoted = removeQuotedContent(text);

	// Normalize whitespace: collapse multiple spaces/newlines to single space
	const normalized = unquoted.replace(/\s+/g, " ").trim();

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
 * Extract text content from parsed email for snippet generation.
 *
 * Prefers plain text over HTML. If only HTML is available,
 * the caller should strip HTML tags before calling generateSnippet.
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
): string => {
	// Prefer plain text
	if (textContent) {
		return generateSnippet(textContent, maxLength);
	}

	// Fall back to HTML (caller should strip tags)
	if (htmlContent) {
		// Basic HTML tag stripping - for more robust handling, use html-to-text
		const stripped = htmlContent
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"');
		return generateSnippet(stripped, maxLength);
	}

	return "";
};
