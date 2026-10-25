export interface QueueMessage<T> {
	readonly body: T;
}

export interface GroupedQueueMessage<T> extends QueueMessage<T> {
	readonly groupId: string;
}

export interface FifoQueueMessage<T> extends GroupedQueueMessage<T> {
	readonly deduplicationId: string;
}

export interface QueueBatchResult {
	readonly refused: ReadonlySet<number>;
}

// The smallest batch every queue backend accepts (SQS caps a batch at ten).
export const QUEUE_BATCH_LIMIT = 10;

export type QueueKind = "Standard" | "Grouped" | "Fifo";

export interface QueueProducerOf<K extends QueueKind, M> {
	readonly kind: K;
	readonly send: (message: M) => Promise<void>;
	readonly sendBatch: (messages: readonly M[]) => Promise<QueueBatchResult>;
}

export type QueueProducer<T> = QueueProducerOf<"Standard", QueueMessage<T>>;

export type GroupedQueueProducer<T> = QueueProducerOf<
	"Grouped",
	GroupedQueueMessage<T>
>;

export type FifoQueueProducer<T> = QueueProducerOf<"Fifo", FifoQueueMessage<T>>;
