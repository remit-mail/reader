import type { RemitImapBodyPartResponse } from "@remit/api-http-client/types.gen.ts";
import { ContentDisposition } from "@remit/domain-enums";
import { sanitizeAttachmentFilename } from "@remit/ui";

/**
 * The attachment-disposition body parts of a message, in the order the message
 * declares them. `pickRenderablePart` (message-body-source.ts) drops exactly
 * these parts so the renderer never treats a PDF as a body; this is the other
 * half of that split.
 */
export interface MessageAttachment {
	bodyPartId: string;
	/** Display and save name — sanitized once, used for both. */
	filename: string;
	typeLabel: string;
	sizeOctets: number;
	contentUrl: string;
}

const typeLabelFor = (mediaSubtype: string): string => {
	const label = mediaSubtype.toUpperCase();
	return label === "OCTET-STREAM" ? "FILE" : label;
};

/**
 * `application/pdf` → `attachment.pdf`. Only used when the sender declared no
 * filename; a subtype with nothing alphanumeric in it yields a bare
 * `attachment`.
 */
const fallbackFilenameFor = (mediaSubtype: string): string => {
	const extension = mediaSubtype.toLowerCase().replace(/[^a-z0-9]/g, "");
	return extension.length > 0 ? `attachment.${extension}` : "attachment";
};

export const selectMessageAttachments = (
	parts: readonly RemitImapBodyPartResponse[],
): MessageAttachment[] =>
	parts
		.filter(
			(part) =>
				!part.isMultipart &&
				part.disposition === ContentDisposition.Attachment &&
				part.contentUrl.length > 0,
		)
		.map((part) => ({
			bodyPartId: part.bodyPartId,
			filename: sanitizeAttachmentFilename(
				part.dispositionFilename ?? "",
				fallbackFilenameFor(part.mediaSubtype),
			),
			typeLabel: typeLabelFor(part.mediaSubtype),
			sizeOctets: part.sizeOctets,
			contentUrl: part.contentUrl,
		}));
