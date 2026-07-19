import { readFileSync } from "node:fs";
import type { QueueDefinition, QueueStore } from "./store.js";

export interface QueuesConfig {
	readonly accountId: string;
	readonly queues: readonly QueueDefinition[];
}

interface RawDeadLetter {
	name: unknown;
	maxReceiveCount: unknown;
}

interface RawQueue {
	name?: unknown;
	fifo?: unknown;
	visibilityTimeoutSeconds?: unknown;
	contentBasedDeduplication?: unknown;
	deadLetter?: RawDeadLetter;
}

interface RawConfig {
	accountId?: unknown;
	queues?: unknown;
}

const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 30;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseQueue = (raw: unknown): QueueDefinition => {
	if (!isRecord(raw)) throw new Error("queue entry must be an object");
	const { name, fifo, visibilityTimeoutSeconds, contentBasedDeduplication } =
		raw as RawQueue;
	if (typeof name !== "string" || name.length === 0) {
		throw new Error("queue entry requires a non-empty string name");
	}
	const isFifo = typeof fifo === "boolean" ? fifo : name.endsWith(".fifo");

	const definition: QueueDefinition = {
		name,
		fifo: isFifo,
		visibilityTimeoutSeconds:
			typeof visibilityTimeoutSeconds === "number"
				? visibilityTimeoutSeconds
				: DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
		contentBasedDeduplication: contentBasedDeduplication === true,
	};

	const deadLetter = (raw as RawQueue).deadLetter;
	if (deadLetter === undefined) return definition;
	if (
		typeof deadLetter.name !== "string" ||
		typeof deadLetter.maxReceiveCount !== "number"
	) {
		throw new Error(
			`queue ${name}: deadLetter requires a string name and numeric maxReceiveCount`,
		);
	}
	return {
		...definition,
		deadLetterTargetName: deadLetter.name,
		maxReceiveCount: deadLetter.maxReceiveCount,
	};
};

export const parseQueuesConfig = (raw: unknown): QueuesConfig => {
	if (!isRecord(raw)) throw new Error("queues config must be an object");
	const { accountId, queues } = raw as RawConfig;
	if (!Array.isArray(queues)) {
		throw new Error("queues config requires a `queues` array");
	}
	return {
		accountId: typeof accountId === "string" ? accountId : "000000000000",
		queues: queues.map(parseQueue),
	};
};

export const loadQueuesConfig = (path: string): QueuesConfig =>
	parseQueuesConfig(JSON.parse(readFileSync(path, "utf8")));

/**
 * Declares every queue in the config on the store. Dead-letter targets are
 * declared before the source queues that reference them so a redrive never
 * points at a queue the store has not seen.
 */
export const bootstrapQueues = (
	store: QueueStore,
	config: QueuesConfig,
): void => {
	const deadLetterNames = new Set(
		config.queues
			.map((q) => q.deadLetterTargetName)
			.filter((name): name is string => name !== undefined),
	);
	const ordered = [
		...config.queues.filter((q) => deadLetterNames.has(q.name)),
		...config.queues.filter((q) => !deadLetterNames.has(q.name)),
	];
	for (const queue of ordered) {
		store.upsertQueue(queue);
	}
};
