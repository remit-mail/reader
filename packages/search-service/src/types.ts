import type { MessageCategory } from "@remit/api-openapi-types";
import { z } from "zod";

export const searchIndexMessageSchema = z.object({
	eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
	entity: z.literal("Message"),
	eventID: z.string(),
	eventTimestamp: z.number(),
	accountId: z.string().min(1),
	keys: z.object({ pk: z.string(), sk: z.string() }),
	messageId: z.string().min(1),
	/** Re-PUT every vector regardless of content hash (deliberate full re-embed / repair). */
	force: z.boolean().optional(),
});

export type SearchIndexMessage = z.infer<typeof searchIndexMessageSchema>;

export type ChunkType =
	| "sender"
	| "recipient"
	| "subject"
	| "attachment"
	| "body"
	| "entities";

export interface ChunkMetadata {
	messageId: string;
	threadId: string;
	accountConfigId: string;
	mailboxIds: string[];
	chunkType: ChunkType;
	sentDate: number;
	isRead: boolean;
	hasAttachment: boolean;
	hasStars: boolean;
	fileTypes?: string[];
	/** Display name of the sender. Stored at index time; absent for pre-enrichment vectors. */
	fromName?: string | null;
	/** Message subject. Stored at index time; absent for pre-enrichment vectors. */
	subject?: string;
	/** Header-derived category. Stored at index time; absent for pre-enrichment vectors. */
	category?: MessageCategory;
	/**
	 * sha256 over the embedding model/version id and the chunk's embeddable text.
	 * Lets a re-index skip an unchanged chunk and re-embed only when content or the
	 * embedding model changes. Absent on pre-hash vectors (re-PUT once to populate).
	 */
	contentHash?: string;
	/**
	 * Prefix of the chunk's embeddable text, stored at index time and used for the
	 * literal-match re-rank in search.ts. Bounded independently by char count
	 * (`TEXT_PREVIEW_MAX_CHARS`) and UTF-8 byte size (`TEXT_PREVIEW_MAX_BYTES`,
	 * search.ts) — the byte bound keeps this field, plus the rest of a vector's
	 * filterable metadata, under the S3 Vectors 2 KB/vector filterable cap even for
	 * multi-byte text (CJK, Cyrillic, Arabic, emoji). Absent for vectors written
	 * before this field existed — those are re-ranked as cosine-only
	 * (score-neutral), never penalized. No backfill; a preview appears organically
	 * the next time a message re-indexes.
	 */
	textPreview?: string;
}

export interface Chunk {
	chunkId: string;
	text: string;
	chunkType: ChunkType;
}

export interface VectorRecord {
	chunkId: string;
	vector: number[];
	metadata: ChunkMetadata;
}

export interface VectorMatch {
	chunkId: string;
	score: number;
	metadata: ChunkMetadata;
}

export interface VectorQueryFilter {
	accountConfigId?: string;
	mailboxId?: string;
	sentDateRange?: { from?: number; to?: number };
	hasAttachment?: boolean;
	hasStars?: boolean;
	isRead?: boolean;
	chunkType?: ChunkType;
	category?: MessageCategory;
}

export interface VectorQuery {
	vector: number[];
	topK: number;
	filter?: VectorQueryFilter;
}

export interface EnvelopeChunkAddress {
	name: string | null;
	email: string;
}

export interface EnvelopeChunkInput {
	from: EnvelopeChunkAddress;
	to: EnvelopeChunkAddress[];
	cc: EnvelopeChunkAddress[];
	bcc: EnvelopeChunkAddress[];
	subject: string;
	attachments: AttachmentChunkInput[];
}

export interface AttachmentChunkInput {
	filename: string | null;
	contentType: string;
	size: number;
}

export interface ParsedBodyForChunking {
	text: string | null;
	html: string | null;
}

export interface IndexEmailParams {
	envelope: EnvelopeChunkInput;
	parsedBody: ParsedBodyForChunking;
	metadata: Omit<ChunkMetadata, "chunkType" | "fileTypes">;
}

export interface SearchParams {
	query: string;
	accountConfigId: string;
	mailboxId?: string;
	sentDateRange?: { from?: number; to?: number };
	hasAttachment?: boolean;
	hasStars?: boolean;
	isRead?: boolean;
	category?: MessageCategory;
	limit?: number;
}

export interface SearchResult {
	messageId: string;
	threadId: string;
	score: number;
	matchedChunkType: ChunkType;
	mailboxIds: string[];
	/** Sender display name, populated for messages indexed after display-field enrichment. */
	fromName?: string | null;
	/** Message subject, populated for messages indexed after display-field enrichment. */
	subject?: string;
	/** Sent date as Unix epoch seconds, always populated. */
	sentDate: number;
	/** Header-derived category, populated for messages indexed after category enrichment. */
	category?: MessageCategory;
}
