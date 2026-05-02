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

import { ROOT_PART_PATH } from "@remit/remit-electrodb-service";
import {
	ContentDisposition,
	MediaType,
	MultipartSubtype,
	TransferEncoding,
} from "@remit/domain-enums";

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

const splitContentType = (
	type: string,
): { mediaType: MediaTypeValue; mediaSubtype: string } => {
	const slashIndex = type.indexOf("/");
	if (slashIndex < 0) {
		throw new Error(
			`mime-walker: malformed Content-Type "${type}" (missing "/" separator)`,
		);
	}
	const topRaw = type.slice(0, slashIndex);
	const subRaw = type.slice(slashIndex + 1);
	const top = topRaw.toLowerCase();
	const mediaType = MEDIA_TYPE_BY_TOP_LEVEL[top];
	if (!mediaType) {
		throw new Error(
			`mime-walker: unknown MIME top-level type "${topRaw}" in "${type}"`,
		);
	}
	const mediaSubtype = subRaw.toLowerCase();
	if (mediaSubtype.length === 0) {
		throw new Error(
			`mime-walker: missing MIME subtype in Content-Type "${type}"`,
		);
	}
	return { mediaType, mediaSubtype };
};

const mapTransferEncoding = (
	encoding: string | undefined,
): TransferEncodingValue => {
	if (!encoding) return TransferEncoding.SevenBit;
	const mapped = TRANSFER_ENCODING_BY_VALUE[encoding.toLowerCase()];
	if (!mapped) {
		throw new Error(`mime-walker: unknown transfer encoding "${encoding}"`);
	}
	return mapped;
};

const mapDisposition = (
	disposition: string | undefined,
): ContentDispositionValue | undefined => {
	if (!disposition) return undefined;
	const mapped = DISPOSITION_BY_VALUE[disposition.toLowerCase()];
	if (!mapped) {
		throw new Error(
			`mime-walker: unknown Content-Disposition "${disposition}"`,
		);
	}
	return mapped;
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
 * "1.2", "2.1.3"). Throws on an unrecognized MIME top-level type, an
 * unknown transfer encoding, or an unknown Content-Disposition so callers
 * can fail loudly instead of silently dropping parts.
 */
export const walkMimeStructure = (root: MimeNode): BodyPartRecord[] => {
	const out: BodyPartRecord[] = [];

	const visit = (node: MimeNode, parentPath: string | null) => {
		const partPath =
			node.part && node.part.length > 0 ? node.part : ROOT_PART_PATH;
		out.push(toRecord(node, partPath, parentPath));
		const children = node.childNodes ?? [];
		for (const child of children) {
			visit(child, partPath);
		}
	};

	visit(root, null);
	return out;
};
