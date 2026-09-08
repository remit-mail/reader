import { UNKNOWN_CHUNK_EMBEDDING_ID } from "./anchor.js";

/**
 * One indexed chunk, reduced to the two facts a provenance report is about: the
 * message it belongs to, and the embedder that produced its vector. Vectors
 * written before `metadata.embeddingId` existed carry no id at all (RFC 039 /
 * #349), which is a third state and not "the current model".
 */
export interface IndexedChunkProvenance {
	messageId: string;
	embeddingId: string | undefined;
}

export interface IndexProvenanceGroup {
	embeddingId: string;
	chunks: number;
	messages: number;
	/** Whether this group's vectors came from the embedder configured now. */
	current: boolean;
}

export interface IndexProvenance {
	configuredEmbeddingId: string;
	chunks: number;
	messages: number;
	groups: IndexProvenanceGroup[];
}

/**
 * Count an index by the embedder its vectors came from, against the one this
 * deployment is configured with (#455). Switching the embedder re-embeds a
 * message only when something touches it, so an index that has seen a switch
 * holds two vector spaces whose distances are not comparable — a silent ranking
 * loss that no query result distinguishes from having nothing indexed.
 *
 * The chunks are an `Iterable` rather than an array so a caller can stream a
 * cursor through it: an index is one row per chunk, several per message, and a
 * corpus-sized report must not materialize all of them to count them.
 */
export const summarizeIndexProvenance = (
	configuredEmbeddingId: string,
	chunks: Iterable<IndexedChunkProvenance>,
): IndexProvenance => {
	const groups = new Map<string, { chunks: number; messages: Set<string> }>();
	const messages = new Set<string>();
	let total = 0;
	for (const chunk of chunks) {
		const embeddingId = chunk.embeddingId ?? UNKNOWN_CHUNK_EMBEDDING_ID;
		const group = groups.get(embeddingId) ?? {
			chunks: 0,
			messages: new Set<string>(),
		};
		group.chunks += 1;
		group.messages.add(chunk.messageId);
		groups.set(embeddingId, group);
		messages.add(chunk.messageId);
		total += 1;
	}
	return {
		configuredEmbeddingId,
		chunks: total,
		messages: messages.size,
		groups: [...groups]
			.map(([embeddingId, group]) => ({
				embeddingId,
				chunks: group.chunks,
				messages: group.messages.size,
				current: embeddingId === configuredEmbeddingId,
			}))
			// Largest first, then by id, so two runs over an unchanged index print
			// the same report and a diff between two runs is a real change.
			.sort(
				(a, b) =>
					b.chunks - a.chunks || a.embeddingId.localeCompare(b.embeddingId),
			),
	};
};

const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The report as an operator reads it, one fact per line. Every line states what
 * it means for search rather than leaving a number to be interpreted: a count
 * under an older model is vectors that still answer queries, from a space of
 * their own.
 */
export const formatIndexProvenance = (report: IndexProvenance): string => {
	const lines = [
		`Configured embedder: ${report.configuredEmbeddingId}`,
		`Indexed:             ${plural(report.chunks, "vector")} over ${plural(
			report.messages,
			"message",
		)}`,
	];
	if (report.groups.length === 0) {
		lines.push(
			"",
			"Nothing is indexed. Semantic filters and the Organize semantic widen match",
			"nothing until the worker has embedded this mailbox.",
		);
		return `${lines.join("\n")}\n`;
	}
	lines.push("", "By the embedder that wrote them:");
	for (const group of report.groups) {
		const mark = group.current ? "current" : "older model";
		lines.push(
			`  ${group.embeddingId}  ${plural(group.chunks, "vector")} over ${plural(
				group.messages,
				"message",
			)} (${mark})`,
		);
	}
	const stale = report.groups.filter((group) => !group.current);
	if (stale.length > 0) {
		const staleMessages = stale.reduce(
			(total, group) => total + group.messages,
			0,
		);
		lines.push(
			"",
			`${plural(staleMessages, "message")} carry vectors from an embedder this`,
			"deployment is no longer configured with. They are compared against current",
			"vectors as though they shared a vector space, which they do not, and they",
			"are re-embedded only when something touches the message.",
		);
	}
	return `${lines.join("\n")}\n`;
};
