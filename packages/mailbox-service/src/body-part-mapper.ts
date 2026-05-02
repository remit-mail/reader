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
 * If a non-multipart leaf can't be resolved, we throw — silent drops would
 * mean the SPA hits a 404 on its `cid:`-rewritten image URL.
 */

import { Buffer } from "node:buffer";
import type { BodyPartItem } from "@remit/remit-electrodb-service";
import type { ParsedMail } from "mailparser";

export interface MappedBodyPart {
	partPath: string;
	contentType: string;
	content: Buffer;
}

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
	for (let i = 0; i < attachments.length; i++) {
		if (consumed.has(i)) continue;
		const att = attachments[i];
		if (att.contentType?.toLowerCase() !== targetType) continue;
		if (filename) {
			if (att.filename !== filename) continue;
		}
		return { index: i, content: att.content };
	}
	return null;
};

const isLeaf = (part: Pick<BodyPartItem, "isMultipart">): boolean =>
	!part.isMultipart;

const buildContentType = (
	part: Pick<BodyPartItem, "mediaType" | "mediaSubtype">,
): string => `${part.mediaType.toLowerCase()}/${part.mediaSubtype}`;

/**
 * Pure function: takes the message's BodyPart rows + the mailparser output,
 * returns the bytes-per-partPath that body-sync should persist.
 *
 * Throws if any non-multipart leaf can't be resolved against the parsed
 * mail — fail-loud per `feedback_never_hide_failure`. The caller is
 * expected to wrap and surface this for SQS retries; silently dropping a
 * leaf would corrupt the cid:-rewrite path on the SPA.
 */
export const mapBodyPartsToContent = (
	bodyParts: readonly Pick<
		BodyPartItem,
		| "partPath"
		| "isMultipart"
		| "mediaType"
		| "mediaSubtype"
		| "contentId"
		| "dispositionFilename"
	>[],
	parsed: ParsedMail,
): MappedBodyPart[] => {
	const out: MappedBodyPart[] = [];
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
				out.push({ partPath: part.partPath, contentType, content: buf });
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
				out.push({ partPath: part.partPath, contentType, content: buf });
				continue;
			}
		}

		if (part.contentId) {
			const found = findAttachmentByContentId(parsed, part.contentId);
			if (found) {
				consumed.add(found.index);
				out.push({
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
			out.push({
				partPath: part.partPath,
				contentType,
				content: matched.content,
			});
			continue;
		}

		throw new Error(
			`body-part-mapper: no parsed-mail content for partPath="${part.partPath}" ` +
				`(contentType=${contentType}, contentId=${part.contentId ?? "<none>"}, ` +
				`filename=${part.dispositionFilename ?? "<none>"})`,
		);
	}

	return out;
};
