/**
 * Message parsing utilities for extracting content from raw RFC822 messages.
 */

import { simpleParser } from "mailparser";

export interface ParsedMessageContent {
	text: string | null;
	html: string | null;
}

/**
 * Parse a raw RFC822 message buffer and extract text/html content.
 *
 * @param buffer - The raw message content (RFC822 format)
 * @returns Parsed content with text and html fields
 */
export const parseMessageContent = async (
	buffer: Buffer,
): Promise<ParsedMessageContent> => {
	const parsed = await simpleParser(buffer);
	return {
		text: parsed.text ?? null,
		html: typeof parsed.html === "string" ? parsed.html : null,
	};
};
