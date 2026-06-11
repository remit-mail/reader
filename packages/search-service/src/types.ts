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
}
