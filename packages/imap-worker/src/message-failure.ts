import type { Logger } from "@remit/logger-lambda";

/**
 * SQS redrive max-receive count configured on every worker queue
 * (`infra/stacks/dev/stacks/remit-queue-stack.ts`, `MAX_RECEIVE_COUNT`). After
 * this many failed deliveries SQS itself moves the message to the queue's DLQ.
 */
export const MAX_RECEIVE_COUNT = 3;

export interface ReceivedMessage {
	body: string;
	receiptHandle: string;
	messageId?: string;
	/** SQS `ApproximateReceiveCount` attribute; 1 on first delivery. */
	receiveCount: number;
}

/**
 * Poison-pill handling for the long-polling worker.
 *
 * We deliberately do NOT delete a message that failed to process. Leaving it
 * un-deleted lets its visibility timeout lapse so SQS redelivers it, and each
 * redelivery increments `ApproximateReceiveCount`. Once that reaches the
 * queue's configured `maxReceiveCount` (see {@link MAX_RECEIVE_COUNT}), SQS
 * moves the message to the DLQ automatically — no manual DLQ send or
 * attempt-counter is needed, and the FIFO `messageDeduplicationId` is preserved.
 *
 * This mirrors the Lambda entry path (`src/index.ts`), which surfaces failures
 * via the partial-batch-failure protocol and relies on the same redrive policy.
 *
 * The only responsibility here is observability: log every failure with its
 * attempt count, and log loudly when a message has exhausted its retries and is
 * being dead-lettered, so a poison pill is never a silent drop.
 */
export const handleMessageFailure = (
	message: ReceivedMessage,
	error: unknown,
	log: Logger,
): void => {
	const willDeadLetter = message.receiveCount >= MAX_RECEIVE_COUNT;
	const context = {
		error,
		stack: error instanceof Error ? error.stack : undefined,
		messageId: message.messageId,
		receiveCount: message.receiveCount,
		maxReceiveCount: MAX_RECEIVE_COUNT,
	};

	if (willDeadLetter) {
		log.error(
			context,
			"Message exhausted retries, leaving for SQS to dead-letter",
		);
		return;
	}

	log.error(context, "Failed to process message, will be redelivered by SQS");
};
