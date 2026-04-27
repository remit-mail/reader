import type {
	Chunk,
	EnvelopeChunkInput,
	ParsedBodyForChunking,
} from "../types.js";
import { buildEntityChunks } from "./entities.js";
import { buildBodyChunks } from "./entropy.js";
import { buildStructuredChunks } from "./structured.js";

export interface ChunkInput {
	envelope: EnvelopeChunkInput;
	parsedBody: ParsedBodyForChunking;
	messageId: string;
}

export interface EmailChunker {
	chunk(input: ChunkInput): Chunk[];
}

const stripHtml = (html: string): string =>
	html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();

const bodyText = (parsed: ParsedBodyForChunking): string => {
	if (parsed.text && parsed.text.trim().length > 0) return parsed.text;
	if (parsed.html && parsed.html.trim().length > 0)
		return stripHtml(parsed.html);
	return "";
};

export const createEmailChunker = (): EmailChunker => ({
	chunk: ({ envelope, parsedBody, messageId }: ChunkInput): Chunk[] => {
		const chunkIdFor = (suffix: string): string => `${messageId}::${suffix}`;
		const chunks: Chunk[] = [];
		chunks.push(...buildStructuredChunks(envelope, chunkIdFor));

		const text = bodyText(parsedBody);
		if (text.length > 0) {
			chunks.push(...buildBodyChunks(text, chunkIdFor));
			chunks.push(...buildEntityChunks(text, chunkIdFor));
		}

		return chunks;
	},
});
