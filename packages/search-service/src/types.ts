import { z } from "zod";

export const searchIndexMessageSchema = z.object({
	eventName: z.enum(["INSERT", "MODIFY", "REMOVE"]),
	entity: z.literal("Message"),
	eventID: z.string(),
	eventTimestamp: z.number(),
	accountId: z.string().min(1),
	keys: z.object({ pk: z.string(), sk: z.string() }),
	messageId: z.string().min(1),
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
	/** Email address of the sender. Stored at index time; absent for pre-enrichment vectors. */
	fromEmail?: string;
	/** Message subject. Stored at index time; absent for pre-enrichment vectors. */
	subject?: string;
	/** True when the provider's spam filter classified this message as spam. Absent for vectors indexed before the spam/auth signals were added. */
	providerSpamClassified?: boolean;
	/** DMARC verdict string (e.g. "Pass"). Absent for vectors indexed before the spam/auth signals were added. */
	authResultDmarc?: string;
	/** True when DKIM signing domains are present and none aligns with the From domain. Absent for vectors indexed before the spam/auth signals were added. */
	dkimMismatch?: boolean;
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
	providerSpamClassified?: boolean;
	authResultDmarc?: string;
	dkimMismatch?: boolean;
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
	providerSpamClassified?: boolean;
	authResultDmarc?: string;
	dkimMismatch?: boolean;
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
	/** Sender email address, populated for messages indexed after the spam/auth signals were added. */
	fromEmail?: string;
	/** Message subject, populated for messages indexed after display-field enrichment. */
	subject?: string;
	/** Sent date as Unix epoch seconds, always populated. */
	sentDate: number;
}
