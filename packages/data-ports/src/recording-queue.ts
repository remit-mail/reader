import type { QueueMessage, QueueProducer } from "./interfaces/queue.js";

export interface RecordedMessage {
	body: Record<string, unknown>;
	groupId: string | undefined;
	deduplicationId: string | undefined;
}

export interface RecordingQueue extends QueueProducer<unknown> {
	readonly sent: RecordedMessage[];
	readonly answer: (next: () => Promise<unknown>) => void;
	readonly refuse: (positions: readonly number[]) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (message: object, field: string): string | undefined => {
	const value: unknown = Reflect.get(message, field);
	return typeof value === "string" ? value : undefined;
};

const recorded = (message: QueueMessage<unknown>): RecordedMessage => {
	const body: unknown = JSON.parse(JSON.stringify(message.body));
	if (!isRecord(body)) throw new Error("A queued body must be an object");
	return {
		body,
		groupId: stringField(message, "groupId"),
		deduplicationId: stringField(message, "deduplicationId"),
	};
};

export const recordingQueue = (): RecordingQueue => {
	const sent: RecordedMessage[] = [];
	let answer: () => Promise<unknown> = async () => ({});
	let refused: ReadonlySet<number> = new Set();
	return {
		sent,
		answer: (next) => {
			answer = next;
		},
		refuse: (positions) => {
			refused = new Set(positions);
		},
		send: async (message) => {
			sent.push(recorded(message));
			await answer();
		},
		sendBatch: async (messages) => {
			sent.push(...messages.map(recorded));
			await answer();
			return { refused };
		},
	};
};

export const failingQueue = (error: unknown): RecordingQueue => {
	const queue = recordingQueue();
	queue.answer(async () => {
		throw error;
	});
	return queue;
};
