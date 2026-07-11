import { extractDocText } from "./extractors/doc.js";
import { extractDocxText } from "./extractors/docx.js";
import { extractPdfText } from "./extractors/pdf.js";
import { extractPlainText } from "./extractors/text.js";
import { normalizeText, truncateToByteLimit } from "./normalize.js";
import { resolveType } from "./type-resolution.js";
import {
	DEFAULT_EXTRACTION_CONFIG,
	type ExtractionConfig,
	type ExtractionInput,
	type ExtractionResult,
	type Extractor,
} from "./types.js";

interface ParsedContent {
	text: string;
	pages?: number;
}

type ParseOutcome =
	| { ok: true; content: ParsedContent }
	| { ok: false; error: unknown };

const EXTRACTORS: Record<Extractor, (bytes: Buffer) => Promise<ParsedContent>> =
	{
		pdf: async (bytes) => extractPdfText(bytes),
		docx: async (bytes) => ({ text: await extractDocxText(bytes) }),
		doc: async (bytes) => ({ text: await extractDocText(bytes) }),
		text: async (bytes) => ({ text: extractPlainText(bytes) }),
	};

/** Malformed attachment bytes from the wild are an expected data condition, not a
 * programmer error; letting this reject would poison an SQS batch (issue #449), so
 * every parser failure is captured here and reported as an `ExtractionResult` instead. */
const runExtractor = (
	extractor: Extractor,
	bytes: Buffer,
): Promise<ParseOutcome> =>
	EXTRACTORS[extractor](bytes)
		.then((content): ParseOutcome => ({ ok: true, content }))
		.catch((error: unknown): ParseOutcome => ({ ok: false, error }));

export const extractAttachmentText = async (
	input: ExtractionInput,
	config: ExtractionConfig = DEFAULT_EXTRACTION_CONFIG,
): Promise<ExtractionResult> => {
	if (input.bytes.length > config.maxInputBytes) {
		return { status: "skipped", reason: "too-large" };
	}

	if (input.bytes.length === 0) {
		return { status: "skipped", reason: "empty" };
	}

	const resolved = await resolveType(
		input.bytes,
		input.declaredMediaType,
		input.filename,
		config.allowedTypes,
	);
	if (resolved === undefined) {
		return { status: "skipped", reason: "type-not-allowed" };
	}

	const outcome = await runExtractor(resolved.extractor, input.bytes);
	if (!outcome.ok) {
		const message =
			outcome.error instanceof Error
				? outcome.error.message
				: String(outcome.error);
		return { status: "failed", reason: `${resolved.extractor}: ${message}` };
	}
	const parsed = outcome.content;

	const normalized = normalizeText(parsed.text);
	if (normalized.trim() === "") {
		return { status: "skipped", reason: "empty" };
	}

	const { text, truncated } = truncateToByteLimit(
		normalized,
		config.maxTextBytes,
	);

	if (resolved.extractor === "pdf" && parsed.pages !== undefined) {
		const charsPerPage =
			parsed.pages > 0 ? normalized.length / parsed.pages : 0;
		return {
			status: "extracted",
			text,
			extractor: resolved.extractor,
			pages: parsed.pages,
			charsPerPage,
			truncated,
		};
	}

	return {
		status: "extracted",
		text,
		extractor: resolved.extractor,
		truncated,
	};
};
