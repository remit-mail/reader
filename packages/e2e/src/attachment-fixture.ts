import type { Message } from "./imap.js";

/**
 * The message that carries files.
 *
 * Scratch, not part of the global seed: the serial suite asserts the inbox holds
 * exactly `seededSubjects`, and thirteen specs derive counts from it. The spec
 * appends this itself and deletes it on the way out, the same contract
 * `mobile-organize-flow` and `mobile-selection-bar` use for their own fixtures.
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

export const attachmentMessage = (subject: string): Message => ({
	subject,
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
});
