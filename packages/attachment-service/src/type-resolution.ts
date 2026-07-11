import { extname } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { Extractor } from "./types.js";

const OCTET_STREAM = "application/octet-stream";

const MEDIA_TYPE_EXTRACTORS: Record<string, Extractor> = {
	"application/pdf": "pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		"docx",
	"application/msword": "doc",
	"text/plain": "text",
};

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
	".docx":
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".doc": "application/msword",
	".txt": "text/plain",
};

export interface ResolvedType {
	mediaType: string;
	extractor: Extractor;
}

const mediaTypeFromExtension = (
	filename: string | undefined,
): string | undefined => {
	if (!filename) return undefined;
	return EXTENSION_MEDIA_TYPES[extname(filename).toLowerCase()];
};

export const resolveMediaType = async (
	bytes: Buffer,
	declaredMediaType: string,
	filename: string | undefined,
): Promise<string | undefined> => {
	const declared = declaredMediaType.trim().toLowerCase();
	if (declared !== "" && declared !== OCTET_STREAM) return declared;

	const sniffed = await fileTypeFromBuffer(bytes);
	if (sniffed?.mime) return sniffed.mime;

	return mediaTypeFromExtension(filename);
};

export const resolveType = async (
	bytes: Buffer,
	declaredMediaType: string,
	filename: string | undefined,
	allowedTypes: readonly string[],
): Promise<ResolvedType | undefined> => {
	const mediaType = await resolveMediaType(bytes, declaredMediaType, filename);
	if (mediaType === undefined) return undefined;
	if (!allowedTypes.includes(mediaType)) return undefined;

	const extractor = MEDIA_TYPE_EXTRACTORS[mediaType];
	if (extractor === undefined) return undefined;

	return { mediaType, extractor };
};
