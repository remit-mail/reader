import { parseArgs } from "node:util";
import {
	type IndexedChunkProvenance,
	type ReembedScope,
	selectMessagesToReembed,
} from "@remit/search-service";
import type { EmbeddingProvider } from "@remit/search-service/from-env";

export interface ReembedQueue {
	requestReembed(
		messageIds: string[],
	): Promise<{ queued: number; alreadyQueued: number }>;
}

export interface ReembedResult {
	configuredEmbeddingId: string;
	scope: ReembedScope;
	selected: number;
	queued: number;
	alreadyQueued: number;
}

export const reembedRefusal = (
	provider: EmbeddingProvider,
): string | undefined => {
	if (provider !== "off" && provider !== "deterministic") return undefined;
	return `SEARCH_EMBEDDING_PROVIDER is ${provider}, so there is no model to re-embed with and every indexed message would be queued. Turn semantic search on first.`;
};

export const parseReembedScope = (args: string[]): ReembedScope => {
	const { values } = parseArgs({
		args,
		options: {
			all: { type: "boolean" },
			model: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	if (values.all && values.model !== undefined) {
		throw new Error("reembed: pass one of --all or --model, not both");
	}
	if (values.all) return { kind: "all" };
	if (values.model !== undefined) {
		return { kind: "model", embeddingId: values.model };
	}
	return { kind: "stale" };
};

export const reembedIndex = async (config: {
	configuredEmbeddingId: string;
	scope: ReembedScope;
	readChunks: (
		consume: (chunks: Iterable<IndexedChunkProvenance>) => string[],
	) => Promise<string[]>;
	queue: ReembedQueue;
}): Promise<ReembedResult> => {
	const messageIds = await config.readChunks((chunks) =>
		selectMessagesToReembed(config.configuredEmbeddingId, chunks, config.scope),
	);
	const request =
		messageIds.length === 0
			? { queued: 0, alreadyQueued: 0 }
			: await config.queue.requestReembed(messageIds);
	return {
		configuredEmbeddingId: config.configuredEmbeddingId,
		scope: config.scope,
		selected: messageIds.length,
		...request,
	};
};

const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const nothingSelected = (result: ReembedResult): string => {
	switch (result.scope.kind) {
		case "all":
			return "Nothing is indexed, so there is nothing to re-embed.";
		case "model":
			return `No indexed message carries vectors from ${result.scope.embeddingId}, so nothing was queued.`;
		case "stale":
			return `Every indexed message is already on ${result.configuredEmbeddingId}, so nothing was queued. Pass --all to re-embed them anyway.`;
	}
};

export const formatReembed = (result: ReembedResult): string => {
	if (result.selected === 0) return `${nothingSelected(result)}\n`;
	const lines = [
		`Queued ${plural(result.queued, "message")} to re-embed with ${result.configuredEmbeddingId}.`,
	];
	if (result.alreadyQueued > 0) {
		lines.push(
			`Skipped ${plural(result.alreadyQueued, "message")} already waiting for a re-embed.`,
		);
	}
	const gone = result.selected - result.queued - result.alreadyQueued;
	if (gone > 0) {
		lines.push(
			`Skipped ${plural(gone, "indexed message")} no longer in the mailbox.`,
		);
	}
	lines.push(
		"The search-index worker re-embeds them as it drains the queue; 'remit check-index' shows how far it has got.",
		"Wait for it to finish before running this again, or the messages still in the queue are embedded twice.",
	);
	return `${lines.join("\n")}\n`;
};
