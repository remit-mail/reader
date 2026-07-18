/**
 * MIME structure walker.
 *
 * Flattens an IMAP BODYSTRUCTURE tree (as produced by ImapFlow's
 * `MessageStructureObject`) into a list of `BodyPartRecord`s ready to be
 * persisted to the BodyPart / BodyPartParameter tables.
 *
 * Inputs are intentionally typed against a structural subset rather than
 * pulling the imapflow types directly so the walker can be unit-tested
 * without spinning up an IMAP connection.
 */

import {
	ContentDisposition,
	MediaType,
	MultipartSubtype,
	TransferEncoding,
} from "@remit/domain-enums";
import { ROOT_PART_PATH } from "@remit/remit-electrodb-service";

export { ROOT_PART_PATH };

export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType];
export type TransferEncodingValue =
	(typeof TransferEncoding)[keyof typeof TransferEncoding];
export type ContentDispositionValue =
	(typeof ContentDisposition)[keyof typeof ContentDisposition];
export type MultipartSubtypeValue =
	(typeof MultipartSubtype)[keyof typeof MultipartSubtype];

/**
 * Structural shape of an IMAP BODYSTRUCTURE node. Mirrors imapflow's
 * `MessageStructureObject` minus the fields we don't read so this module
 * stays free of an imapflow dependency.
 */
export interface MimeNode {
	/**
	 * Dot-numbered MIME path (e.g., "1", "1.1", "2"). Empty/undefined for
	 * the root node — the walker assigns "0" to it for storage stability.
	 */
	part?: string;
	/** Full Content-Type (e.g., "text/plain", "multipart/mixed"). */
	type: string;
	/** Content-Type parameters (charset, boundary, name, ...). */
	parameters?: Record<string, string>;
	/** Content-ID header value (without angle brackets). */
	id?: string;
	/** Content-Description header value. */
	description?: string;
	/** Transfer encoding (7bit, 8bit, base64, quoted-printable, binary). */
	encoding?: string;
	/** Encoded byte size of this part. */
	size?: number;
	/** Line count for text/* parts. */
	lineCount?: number;
	/** MD5 hash. */
	md5?: string;
	/** Content-Disposition (inline | attachment). */
	disposition?: string;
	/** Content-Disposition parameters (filename, ...). */
	dispositionParameters?: Record<string, string>;
	/** Content-Language values. */
	language?: string[];
	/** Content-Location URI. */
	location?: string;
	/** Children for multipart nodes. */
	childNodes?: MimeNode[];
}

export interface BodyPartParameterRecord {
	parameterName: string;
	parameterValue: string;
}

/**
 * Flattened MIME node ready to upsert. `parentPartPath` is the parent
 * node's `partPath` (or null for the root) so the caller can map paths to
 * the deterministic `bodyPartId`s without re-walking the tree.
 */
export interface BodyPartRecord {
	partPath: string;
	parentPartPath: string | null;
	mediaType: MediaTypeValue;
	mediaSubtype: string;
	contentId?: string;
	contentDescription?: string;
	transferEncoding: TransferEncodingValue;
	sizeOctets: number;
	lineCount?: number;
	md5Hash?: string;
	disposition?: ContentDispositionValue;
	dispositionFilename?: string;
	language?: string;
	location?: string;
	isMultipart: boolean;
	multipartSubtype?: MultipartSubtypeValue;
	parameters: BodyPartParameterRecord[];
}

const MEDIA_TYPE_BY_TOP_LEVEL: Record<string, MediaTypeValue> = {
	text: MediaType.Text,
	image: MediaType.Image,
	audio: MediaType.Audio,
	video: MediaType.Video,
	application: MediaType.Application,
	multipart: MediaType.Multipart,
	message: MediaType.Message,
};

const MULTIPART_SUBTYPE_BY_VALUE: Record<string, MultipartSubtypeValue> = {
	mixed: MultipartSubtype.Mixed,
	alternative: MultipartSubtype.Alternative,
	digest: MultipartSubtype.Digest,
	parallel: MultipartSubtype.Parallel,
	related: MultipartSubtype.Related,
	signed: MultipartSubtype.Signed,
	encrypted: MultipartSubtype.Encrypted,
	"form-data": MultipartSubtype.FormData,
	report: MultipartSubtype.Report,
};

const TRANSFER_ENCODING_BY_VALUE: Record<string, TransferEncodingValue> = {
	"7bit": TransferEncoding.SevenBit,
	"8bit": TransferEncoding.EightBit,
	binary: TransferEncoding.Binary,
	base64: TransferEncoding.Base64,
	"quoted-printable": TransferEncoding.QuotedPrintable,
};

const DISPOSITION_BY_VALUE: Record<string, ContentDispositionValue> = {
	inline: ContentDisposition.Inline,
	attachment: ContentDisposition.Attachment,
};

const FALLBACK_MEDIA_SUBTYPE = "octet-stream";

/**
 * Split a Content-Type into a known media type and its subtype, tolerating
 * malformed values. The Content-Type is copied from an untrusted header, so a
 * missing "/", an unknown top-level type, or an empty subtype must not throw
 * (that would drop the whole message). RFC 2046 §4.5.3 makes
 * `application/octet-stream` the defined default for an unrecognized type, so
 * that is the fallback; the raw subtype is preserved where present.
 */
const splitContentType = (
	type: string,
): { mediaType: MediaTypeValue; mediaSubtype: string } => {
	const slashIndex = type.indexOf("/");
	if (slashIndex < 0) {
		return {
			mediaType: MediaType.Application,
			mediaSubtype: FALLBACK_MEDIA_SUBTYPE,
		};
	}
	const topRaw = type.slice(0, slashIndex);
	const subRaw = type.slice(slashIndex + 1);
	const top = topRaw.toLowerCase();
	const mediaType = MEDIA_TYPE_BY_TOP_LEVEL[top] ?? MediaType.Application;
	const subLower = subRaw.toLowerCase();
	const mediaSubtype = subLower.length > 0 ? subLower : FALLBACK_MEDIA_SUBTYPE;
	return { mediaType, mediaSubtype };
};

/**
 * An absent Content-Transfer-Encoding means 7bit (RFC 2045 §6.1); an
 * unrecognized token is treated as opaque bytes rather than throwing, so a
 * message carrying an exotic encoding still syncs.
 */
const mapTransferEncoding = (
	encoding: string | undefined,
): TransferEncodingValue => {
	if (!encoding) return TransferEncoding.SevenBit;
	return (
		TRANSFER_ENCODING_BY_VALUE[encoding.toLowerCase()] ??
		TransferEncoding.Binary
	);
};

/**
 * An unknown Content-Disposition is treated as absent (undefined) rather than
 * throwing, so a message with a malformed disposition still syncs.
 */
const mapDisposition = (
	disposition: string | undefined,
): ContentDispositionValue | undefined => {
	if (!disposition) return undefined;
	return DISPOSITION_BY_VALUE[disposition.toLowerCase()];
};

const mapMultipartSubtype = (
	subtype: string,
): MultipartSubtypeValue | undefined => {
	const mapped = MULTIPART_SUBTYPE_BY_VALUE[subtype.toLowerCase()];
	if (!mapped) return undefined;
	return mapped;
};

const stripAngles = (value: string): string => value.replace(/^<+|>+$/g, "");

const flattenParameters = (
	params: Record<string, string> | undefined,
): BodyPartParameterRecord[] => {
	if (!params) return [];
	const entries = Object.entries(params).filter(([name, value]) => {
		if (typeof name !== "string" || name.length === 0) return false;
		if (typeof value !== "string") return false;
		return true;
	});
	entries.sort((a, b) => a[0].localeCompare(b[0]));
	return entries.map(([parameterName, parameterValue]) => ({
		parameterName,
		parameterValue,
	}));
};

const toRecord = (
	node: MimeNode,
	partPath: string,
	parentPartPath: string | null,
): BodyPartRecord => {
	const { mediaType, mediaSubtype } = splitContentType(node.type);
	const isMultipart = mediaType === MediaType.Multipart;
	const multipartSubtype = isMultipart
		? mapMultipartSubtype(mediaSubtype)
		: undefined;

	const dispositionFilename =
		node.dispositionParameters?.filename ?? node.parameters?.name ?? undefined;

	const language = node.language?.[0];

	const record: BodyPartRecord = {
		partPath,
		parentPartPath,
		mediaType,
		mediaSubtype,
		transferEncoding: mapTransferEncoding(node.encoding),
		sizeOctets: typeof node.size === "number" ? node.size : 0,
		isMultipart,
		parameters: flattenParameters(node.parameters),
	};

	if (node.id) record.contentId = stripAngles(node.id);
	if (node.description) record.contentDescription = node.description;
	if (typeof node.lineCount === "number") record.lineCount = node.lineCount;
	if (node.md5) record.md5Hash = node.md5;
	const mappedDisposition = mapDisposition(node.disposition);
	if (mappedDisposition) record.disposition = mappedDisposition;
	if (dispositionFilename) record.dispositionFilename = dispositionFilename;
	if (language) record.language = language;
	if (node.location) record.location = node.location;
	if (multipartSubtype) record.multipartSubtype = multipartSubtype;

	return record;
};

/**
 * Walk an IMAP BODYSTRUCTURE tree depth-first and return a flat list of
 * `BodyPartRecord`s. The root node uses `ROOT_PART_PATH` ("0"); all other
 * nodes use the dot-numbered IMAP path that ImapFlow assigns (e.g., "1",
 * "1.2", "2.1.3"). Every field comes from an untrusted BODYSTRUCTURE, so an
 * unrecognized MIME type, transfer encoding, or Content-Disposition maps to a
 * safe default rather than throwing — one malformed part must never drop the
 * whole message.
 *
 * **Part-path uniqueness**: some IMAP servers (and the `message/rfc822`
 * inner-body convention) return child nodes with an empty `part` field.
 * Assigning ROOT_PART_PATH to every such node would produce duplicate keys
 * and cause a DynamoDB "multiple operations on one item" error in
 * `upsertBodyParts`. Non-root nodes without a `part` therefore receive a
 * synthetic path `<parentPath>.<siblingIndex>` that is stable across
 * repeated syncs of the same message.
 */
export const walkMimeStructure = (root: MimeNode): BodyPartRecord[] => {
	const out: BodyPartRecord[] = [];

	const visit = (
		node: MimeNode,
		parentPath: string | null,
		siblingIndex: number,
	) => {
		let partPath: string;
		if (node.part && node.part.length > 0) {
			partPath = node.part;
		} else if (parentPath === null) {
			// True root of the BODYSTRUCTURE tree.
			partPath = ROOT_PART_PATH;
		} else {
			// Non-root node without an IMAP part path — synthesise one so
			// the DynamoDB keys remain unique. This happens most commonly
			// for the body of a message/rfc822 attachment, whose inner
			// structure imapflow attaches as a childNode with part="".
			partPath = `${parentPath}.${siblingIndex}`;
		}
		out.push(toRecord(node, partPath, parentPath));
		const children = node.childNodes ?? [];
		for (let i = 0; i < children.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: value is guaranteed by caller contract
			visit(children[i]!, partPath, i + 1);
		}
	};

	visit(root, null, 0);
	return out;
};
