/**
 * Map persisted BodyPart rows back to the bytes mailparser produced for the
 * same message. Used by body-sync to write per-part S3 objects (so the
 * CloudFront `contentUrl` returned by describeMessage actually serves
 * something — see #133/#298).
 *
 * `mailparser.simpleParser` flattens MIME structure: it returns `text`,
 * `html`, and a flat `attachments[]` with no `partPath`. We re-attach the
 * partPath by:
 *   1. Skipping multipart container rows (no bytes of their own).
 *   2. Routing the first text/plain leaf to `parsed.text`.
 *   3. Routing the first text/html leaf to `parsed.html`.
 *   4. Looking up everything else in `parsed.attachments` by Content-ID,
 *      then by `(contentType, filename)`.
 *
 * Content-type tolerance: IMAP BODYSTRUCTURE often labels attachments
 * `application/octet-stream` while mailparser sniffs the real type from the
 * filename extension (e.g. `application/pdf`). When the BodyPart row carries
 * a `dispositionFilename`, filename-equality wins; when the row is
 * `application/octet-stream` we accept any non-text attachment as a fallback.
 *
 * If a non-multipart leaf can't be resolved, we return a `MapResult` with the
 * unresolved entry recorded — the caller decides whether to abort (inline
 * `cid:` images) or log-and-skip (downloadable attachments).
 */

import { Buffer } from "node:buffer";
import type { BodyPartItem } from "@remit/remit-electrodb-service";
import type { ParsedMail } from "mailparser";

export interface MappedBodyPart {
	partPath: string;
	contentType: string;
	content: Buffer;
}

export interface UnresolvedBodyPart {
	partPath: string;
	contentType: string;
	contentId: string | undefined;
	dispositionFilename: string | undefined;
	disposition: "inline" | "attachment" | undefined;
	reason: string;
}

export interface MapResult {
	mapped: MappedBodyPart[];
	unresolved: UnresolvedBodyPart[];
}

const OCTET_STREAM = "application/octet-stream";

const stripAngles = (value: string): string => value.replace(/^<+|>+$/g, "");

const toBuffer = (
	value: string | false | Buffer | undefined,
): Buffer | null => {
	if (value === undefined || value === false) return null;
	if (Buffer.isBuffer(value)) return value;
	return Buffer.from(value, "utf8");
};

const findAttachmentByContentId = (
	parsed: ParsedMail,
	contentId: string,
): { index: number; content: Buffer } | null => {
	const target = stripAngles(contentId).toLowerCase();
	const attachments = parsed.attachments ?? [];
	for (let i = 0; i < attachments.length; i++) {
		const att = attachments[i];
		const candidates = [att.cid, att.contentId];
		for (const cand of candidates) {
			if (typeof cand !== "string") continue;
			if (stripAngles(cand).toLowerCase() === target) {
				return { index: i, content: att.content };
			}
		}
	}
	return null;
};

const findAttachmentByMeta = (
	parsed: ParsedMail,
	contentType: string,
	filename: string | undefined,
	consumed: Set<number>,
): { index: number; content: Buffer } | null => {
	const attachments = parsed.attachments ?? [];
	const targetType = contentType.toLowerCase();
	const targetFilename = filename?.toLowerCase();

	// 1. Exact content-type match (with optional filename) — the common case
	//    where IMAP BODYSTRUCTURE and mailparser agree.
	for (let i = 0; i < attachments.length; i++) {
		if (consumed.has(i)) continue;
		const att = attachments[i];
		if (att.contentType?.toLowerCase() !== targetType) continue;
		if (targetFilename) {
			if (att.filename?.toLowerCase() !== targetFilename) continue;
		}
		return { index: i, content: att.content };
	}

	// 2. Filename-equality match — IMAP often reports
	//    `application/octet-stream` while mailparser refines to the real
	//    type (`application/pdf`) by sniffing the filename extension. If
	//    the row has a filename and that filename matches an attachment,
	//    accept it regardless of mailparser's contentType.
	//
	//    Excluded for `text/*` rows: the inline HTML / inline plain-text
	//    slot must never be filled by an attachment with a coincidentally
	//    matching filename. text/* rows are routed via the parsed.text /
	//    parsed.html paths above and the strict-type path here.
	if (targetFilename && !targetType.startsWith("text/")) {
		for (let i = 0; i < attachments.length; i++) {
			if (consumed.has(i)) continue;
			const att = attachments[i];
			if (att.filename?.toLowerCase() !== targetFilename) continue;
			return { index: i, content: att.content };
		}
	}

	// 3. Octet-stream + no filename: accept any non-text attachment that is
	//    not yet consumed. "Application/octet-stream" is the canonical
	//    unknown-type — mailparser will have refined it. Crucially we refuse
	//    `text/*` to avoid routing inline HTML into an attachment slot.
	if (targetType === OCTET_STREAM) {
		for (let i = 0; i < attachments.length; i++) {
			if (consumed.has(i)) continue;
			const att = attachments[i];
			const attType = att.contentType?.toLowerCase();
			if (!attType || attType.startsWith("text/")) continue;
			return { index: i, content: att.content };
		}
	}

	return null;
};

const isLeaf = (part: Pick<BodyPartItem, "isMultipart">): boolean =>
	!part.isMultipart;

const buildContentType = (
	part: Pick<BodyPartItem, "mediaType" | "mediaSubtype">,
): string => `${part.mediaType.toLowerCase()}/${part.mediaSubtype}`;

type MapperInput = Pick<
	BodyPartItem,
	| "partPath"
	| "isMultipart"
	| "mediaType"
	| "mediaSubtype"
	| "contentId"
	| "dispositionFilename"
	| "disposition"
>;

/**
 * Pure function: takes the message's BodyPart rows + the mailparser output,
 * returns mapped bytes per partPath together with any unresolved leaves.
 *
 * Unresolved leaves are NOT thrown — the caller (body-sync) decides whether
 * a missing leaf is fatal (inline `cid:` image: HTML render breaks) or
 * recoverable (attachment leaf: at worst the download button 404s).
 */
export const mapBodyPartsToContent = (
	bodyParts: readonly MapperInput[],
	parsed: ParsedMail,
): MapResult => {
	const mapped: MappedBodyPart[] = [];
	const unresolved: UnresolvedBodyPart[] = [];
	const consumed = new Set<number>();
	let textConsumed = false;
	let htmlConsumed = false;

	const leaves = bodyParts.filter(isLeaf);

	for (const part of leaves) {
		const contentType = buildContentType(part);

		if (
			!textConsumed &&
			part.mediaType === "TEXT" &&
			part.mediaSubtype === "plain" &&
			typeof parsed.text === "string"
		) {
			textConsumed = true;
			const buf = toBuffer(parsed.text);
			if (buf) {
				mapped.push({ partPath: part.partPath, contentType, content: buf });
				continue;
			}
		}

		if (
			!htmlConsumed &&
			part.mediaType === "TEXT" &&
			part.mediaSubtype === "html" &&
			typeof parsed.html === "string"
		) {
			htmlConsumed = true;
			const buf = toBuffer(parsed.html);
			if (buf) {
				mapped.push({ partPath: part.partPath, contentType, content: buf });
				continue;
			}
		}

		if (part.contentId) {
			const found = findAttachmentByContentId(parsed, part.contentId);
			if (found) {
				consumed.add(found.index);
				mapped.push({
					partPath: part.partPath,
					contentType,
					content: found.content,
				});
				continue;
			}
		}

		const matched = findAttachmentByMeta(
			parsed,
			contentType,
			part.dispositionFilename,
			consumed,
		);
		if (matched) {
			consumed.add(matched.index);
			mapped.push({
				partPath: part.partPath,
				contentType,
				content: matched.content,
			});
			continue;
		}

		unresolved.push({
			partPath: part.partPath,
			contentType,
			contentId: part.contentId ?? undefined,
			dispositionFilename: part.dispositionFilename ?? undefined,
			disposition: part.disposition ?? undefined,
			reason:
				`no parsed-mail content for partPath="${part.partPath}" ` +
				`(contentType=${contentType}, contentId=${part.contentId ?? "<none>"}, ` +
				`filename=${part.dispositionFilename ?? "<none>"})`,
		});
	}

	return { mapped, unresolved };
};
