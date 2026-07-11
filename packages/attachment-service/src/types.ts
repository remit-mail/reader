export interface ExtractionInput {
	bytes: Buffer;
	declaredMediaType: string;
	filename?: string;
}

export interface ExtractionConfig {
	maxInputBytes: number;
	maxTextBytes: number;
	allowedTypes: string[];
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
	maxInputBytes: 10 * 1024 * 1024,
	maxTextBytes: 200 * 1024,
	allowedTypes: [
		"application/pdf",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/msword",
		"text/plain",
	],
};

export type Extractor = "pdf" | "docx" | "doc" | "text";

export type ExtractionResult =
	| {
			status: "extracted";
			text: string;
			extractor: Extractor;
			pages?: number;
			charsPerPage?: number;
			truncated: boolean;
	  }
	| {
			status: "skipped";
			reason: "type-not-allowed" | "too-large" | "empty";
	  }
	| {
			status: "failed";
			reason: string;
	  };
