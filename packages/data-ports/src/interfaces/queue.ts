export interface QueueMessage<T> {
	readonly body: T;
	readonly delaySeconds?: number;
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

export interface QueueProducer<T, M extends QueueMessage<T> = QueueMessage<T>> {
	readonly send: (message: M) => Promise<void>;
	readonly sendBatch: (messages: readonly M[]) => Promise<QueueBatchResult>;
}

export type FifoQueueProducer<T> = QueueProducer<T, FifoQueueMessage<T>>;

export type GroupedQueueProducer<T> = QueueProducer<T, GroupedQueueMessage<T>>;
