/**
 * Pair every persisted `BodyPart` row with the decoded bytes mailparser
 * produced for the same MIME node. Total function: returns one
 * `BodyPartContentPair` per non-multipart leaf, never undefined, never
 * throws on well-formed input.
 *
 * Source of truth (per issue #395):
 *   - `partPath`, `contentType`, `contentId`, `dispositionFilename`,
 *     `sizeOctets` — owned by BODYSTRUCTURE (the `BodyPart` row).
 *   - Decoded bytes — owned by mailparser (`parsed.text`, `parsed.html`,
 *     `parsed.attachments[i].content`).
 *   - `parsed.attachments[i].partId` is also dot-numbered (set at runtime
 *     in `mail-parser.js:860`; missing from `@types/mailparser`; surfaced
 *     here via `./types/mailparser-augment.d.ts`). Structural pairing on
 *     `partId === partPath` is the dominant strategy for non-text leaves.
 *
 * Pipeline (per leaf in declaration order; each step consumes one
 * attachment when it pairs, subsequent steps work on the residual set):
 *   1. text/plain → first leaf gets `parsed.text` (empty Buffer if
 *      `sizeOctets === 0`); subsequent text/plain leaves get empty.
 *   2. text/html → first leaf gets `parsed.html` (empty Buffer if
 *      `sizeOctets === 0`); subsequent text/html leaves get empty.
 *   3. Non-text leaves with `sizeOctets === 0` short-circuit to an empty
 *      Buffer without consuming an attachment — symmetric with the text
 *      path, so the positional fallback can't hand a zero-sized leaf real
 *      bytes that belong to another leaf.
 *   4. Remaining non-text leaves try, in order:
 *      a. `attachment.partId === bodyPart.partPath`
 *      b. contentId match (case + angle-insensitive)
 *      c. dispositionFilename match (case-insensitive)
 *      d. content-type compatibility class: exact → binary-family
 *         (any non-text/*) → text-family
 *      e. positional fallback: next unconsumed attachment in declaration
 *         order. Logs at `debug` so operators can see "we guessed"
 *         pairings without spamming higher levels.
 *   5. Anything still unpaired → zero-byte Buffer + structured `warn` log.
 *
 * The mapper assumes well-formed input — malformed MIME is rejected
 * upstream in `mime-walker.ts`. If a leaf truly has no source bytes
 * available (e.g. mailparser tolerated a malformed message that
 * BODYSTRUCTURE disagrees with on leaf count), it gets the empty-Buffer
 * fallback rather than a throw, so the call site stays simple.
 */

/// <reference path="./types/mailparser-augment.d.ts" />

import { Buffer } from "node:buffer";
import type { BodyPartItem } from "@remit/remit-electrodb-service";
import type { Attachment, ParsedMail } from "mailparser";

export interface BodyPartContentPair {
	partPath: string;
	contentType: string;
	content: Buffer;
}

export type MapperInput = Pick<
	BodyPartItem,
	| "partPath"
	| "isMultipart"
	| "mediaType"
	| "mediaSubtype"
	| "contentId"
	| "dispositionFilename"
	| "disposition"
> & {
	/**
	 * Bytes the BODYSTRUCTURE leaf declares. Optional so hand-built test
	 * inputs don't have to fabricate it — in production every BodyPart row
	 * carries this field. `sizeOctets === 0` is the explicit empty-leaf
	 * signal that text-leaf routing uses to produce a zero-byte Buffer
	 * (see fixture 15-empty-text-part).
	 */
	sizeOctets?: number;
};

export interface MapperLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
	debug?(obj: Record<string, unknown>, msg: string): void;
}

export interface MapperContext {
	messageId?: string;
	logger?: MapperLogger;
}

const EMPTY_BUFFER = Buffer.alloc(0);

const stripAngles = (value: string): string => value.replace(/^<+|>+$/g, "");

const buildContentType = (
	part: Pick<BodyPartItem, "mediaType" | "mediaSubtype">,
): string => `${part.mediaType.toLowerCase()}/${part.mediaSubtype}`;

const textToBuffer = (value: string | false | undefined): Buffer => {
	if (typeof value !== "string" || value.length === 0) return EMPTY_BUFFER;
	return Buffer.from(value, "utf8");
};

const isTextStar = (contentType: string): boolean =>
	contentType.toLowerCase().startsWith("text/");

/** Match `partId === partPath` against an unconsumed attachment. */
const findByPartId = (
	attachments: readonly Attachment[],
	consumed: ReadonlySet<number>,
	partPath: string,
): number | null => {
	for (let i = 0; i < attachments.length; i++) {
		if (consumed.has(i)) continue;
		const att = attachments[i];
		if (typeof att.partId !== "string") continue;
		if (att.partId === partPath) return i;
	}
	return null;
};

/** Match by contentId (case + angle-insensitive). */
const findByContentId = (
	attachments: readonly Attachment[],
	consumed: ReadonlySet<number>,
	contentId: string,
): number | null => {
	const target = stripAngles(contentId).toLowerCase();
	for (let i = 0; i < attachments.length; i++) {
		if (consumed.has(i)) continue;
		const att = attachments[i];
		const candidates = [att.cid, att.contentId];
		for (const cand of candidates) {
			if (typeof cand !== "string") continue;
			if (stripAngles(cand).toLowerCase() === target) return i;
		}
	}
	return null;
};

/** Match by dispositionFilename (case-insensitive). */
const findByFilename = (
	attachments: readonly Attachment[],
	consumed: ReadonlySet<number>,
	filename: string,
): number | null => {
	const target = filename.toLowerCase();
	for (let i = 0; i < attachments.length; i++) {
		if (consumed.has(i)) continue;
		const att = attachments[i];
		if (typeof att.filename !== "string") continue;
		if (att.filename.toLowerCase() === target) return i;
	}
	return null;
};

/**
 * Content-type compatibility class. The BodyPart row's content-type is the
 * sender's verbatim label; mailparser's `att.contentType` is sniffed from
 * filename extension. They often disagree (the Odido bug — postmortem
 * #394 — is `application/octet-stream` vs `application/pdf`).
 *
 * Order:
 *   1. Exact match (`application/pdf` ↔ `application/pdf`).
 *   2. Binary family — leaf is non-`text/*`, attachment is non-`text/*`.
 *      Covers octet-stream ↔ pdf, octet-stream ↔ image, etc.
 *   3. Text family — leaf is `text/*`, attachment is `text/*`. Catches
 *      `text/calendar` / `text/csv` after the inline `text/plain` and
 *      `text/html` slots are taken.
 */
const findByContentTypeClass = (
	attachments: readonly Attachment[],
	consumed: ReadonlySet<number>,
	contentType: string,
): number | null => {
	const target = contentType.toLowerCase();
	const leafIsText = isTextStar(target);

	for (let i = 0; i < attachments.length; i++) {
		if (consumed.has(i)) continue;
		const att = attachments[i];
		if (att.contentType?.toLowerCase() === target) return i;
	}

	if (!leafIsText) {
		for (let i = 0; i < attachments.length; i++) {
			if (consumed.has(i)) continue;
			const att = attachments[i];
			const attType = att.contentType?.toLowerCase();
			if (!attType) continue;
			if (!isTextStar(attType)) return i;
		}
	} else {
		for (let i = 0; i < attachments.length; i++) {
			if (consumed.has(i)) continue;
			const att = attachments[i];
			const attType = att.contentType?.toLowerCase();
			if (!attType) continue;
			if (isTextStar(attType)) return i;
		}
	}

	return null;
};

/** Positional fallback: next unconsumed attachment in declaration order. */
const findPositional = (
	attachments: readonly Attachment[],
	consumed: ReadonlySet<number>,
): number | null => {
	for (let i = 0; i < attachments.length; i++) {
		if (!consumed.has(i)) return i;
	}
	return null;
};

const pairNonTextLeaf = (
	part: MapperInput,
	attachments: readonly Attachment[],
	consumed: Set<number>,
	context: MapperContext,
): { content: Buffer; paired: true } | { paired: false } => {
	const contentType = buildContentType(part);

	// Symmetry with the text-leaf path: a leaf whose BODYSTRUCTURE-declared
	// size is zero has no bytes to find, so do not consume a residual
	// attachment for it (the positional fallback would otherwise hand it
	// real bytes belonging to another leaf — see PR D, review note b).
	if (part.sizeOctets === 0) {
		return { content: EMPTY_BUFFER, paired: true };
	}

	const byPartId = findByPartId(attachments, consumed, part.partPath);
	if (byPartId !== null) {
		consumed.add(byPartId);
		return { content: attachments[byPartId].content, paired: true };
	}

	if (part.contentId) {
		const byCid = findByContentId(attachments, consumed, part.contentId);
		if (byCid !== null) {
			consumed.add(byCid);
			return { content: attachments[byCid].content, paired: true };
		}
	}

	if (part.dispositionFilename) {
		const byName = findByFilename(
			attachments,
			consumed,
			part.dispositionFilename,
		);
		if (byName !== null) {
			consumed.add(byName);
			return { content: attachments[byName].content, paired: true };
		}
	}

	const byType = findByContentTypeClass(attachments, consumed, contentType);
	if (byType !== null) {
		consumed.add(byType);
		return { content: attachments[byType].content, paired: true };
	}

	const positional = findPositional(attachments, consumed);
	if (positional !== null) {
		consumed.add(positional);
		const chosen = attachments[positional];
		// Audit log so operators can see "we guessed" pairings when a
		// well-formed message takes the structural-fallback path. Helps
		// triage cases where mailparser and BODYSTRUCTURE disagree more
		// than the earlier matchers can handle.
		context.logger?.debug?.(
			{
				messageId: context.messageId,
				partPath: part.partPath,
				leafContentType: contentType,
				chosenAttachmentPartId: chosen.partId ?? null,
				chosenAttachmentContentType: chosen.contentType ?? null,
				chosenAttachmentFilename: chosen.filename ?? null,
			},
			"body-part-mapper: positional fallback paired leaf with next residual attachment",
		);
		return { content: chosen.content, paired: true };
	}

	return { paired: false };
};

/**
 * Pair body-part rows with mailparser bytes. Returns one pair per
 * non-multipart leaf, in the order the leaves appear in `bodyParts`.
 *
 * Never throws on well-formed input. Leaves with no source bytes get an
 * empty Buffer; the call site does not need a try/catch.
 */
export const mapBodyPartsToContent = (
	bodyParts: readonly MapperInput[],
	parsed: ParsedMail,
	context: MapperContext = {},
): BodyPartContentPair[] => {
	const pairs: BodyPartContentPair[] = [];
	const attachments = parsed.attachments ?? [];
	const consumed = new Set<number>();
	let textRouted = false;
	let htmlRouted = false;

	for (const part of bodyParts) {
		if (part.isMultipart) continue;

		const contentType = buildContentType(part);
		const isPlain = part.mediaType === "TEXT" && part.mediaSubtype === "plain";
		const isHtml = part.mediaType === "TEXT" && part.mediaSubtype === "html";

		// `sizeOctets === 0` is the explicit empty-leaf signal; an undefined
		// sizeOctets (hand-built test input) is treated as non-empty so we
		// fall through to the text-routing path.
		const isEmptyLeaf = part.sizeOctets === 0;

		if (isPlain) {
			const content =
				!textRouted && !isEmptyLeaf ? textToBuffer(parsed.text) : EMPTY_BUFFER;
			textRouted = true;
			pairs.push({ partPath: part.partPath, contentType, content });
			continue;
		}

		if (isHtml) {
			const content =
				!htmlRouted && !isEmptyLeaf
					? textToBuffer(
							typeof parsed.html === "string" ? parsed.html : undefined,
						)
					: EMPTY_BUFFER;
			htmlRouted = true;
			pairs.push({ partPath: part.partPath, contentType, content });
			continue;
		}

		const result = pairNonTextLeaf(part, attachments, consumed, context);
		if (result.paired) {
			pairs.push({
				partPath: part.partPath,
				contentType,
				content: result.content,
			});
			continue;
		}

		context.logger?.warn(
			{
				messageId: context.messageId,
				partPath: part.partPath,
				contentType,
				contentId: part.contentId,
				filename: part.dispositionFilename,
			},
			"body-part-mapper: no source bytes for leaf; pairing with zero-byte buffer",
		);
		pairs.push({ partPath: part.partPath, contentType, content: EMPTY_BUFFER });
	}

	return pairs;
};
