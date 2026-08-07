import type { Message } from "./imap.js";

/**
 * The one INBOX message in the run that carries files. Seeded pre-onboarding
 * like every other fixture — mail that arrives after the account is connected
 * does not reach the API on a triggered sync, so a mid-run APPEND would test
 * that defect instead of attachments.
 *
 * Both parts are non-text on purpose. In a `multipart/mixed`, the first
 * `text/plain` leaf is the body, and the part mapper gives later `text/plain`
 * leaves nothing — a text attachment would arrive empty and the byte assertion
 * would be measuring the fixture rather than the download.
 */
export const ATTACHMENT_PDF = {
	filename: "board-pack.pdf",
	content: "%PDF-1.4\nRemit e2e attachment payload\n%%EOF\n",
};

/**
 * A filename written to escape the download directory. What the list shows and
 * what the browser saves must both be the final segment.
 */
export const ATTACHMENT_HOSTILE = {
	filename: "../../../etc/passwd",
	sanitizedFilename: "passwd",
	content: "root:x:0:0:hostile fixture:/root:/bin/sh\n",
};

export const ATTACHMENT_SUBJECT = "Board pack for Thursday";

export const ATTACHMENT_MESSAGE: Message = {
	subject: ATTACHMENT_SUBJECT,
	body: "Two files are attached.",
	attachments: [
		{
			filename: ATTACHMENT_PDF.filename,
			contentType: "application/pdf",
			content: ATTACHMENT_PDF.content,
		},
		{
			filename: ATTACHMENT_HOSTILE.filename,
			contentType: "application/octet-stream",
			content: ATTACHMENT_HOSTILE.content,
		},
	],
};
