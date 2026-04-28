import { SendMessageBatchCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { IndexEvent } from "./events.js";

const SQS_BATCH_SIZE = 10;

export const enqueueSearchIndexEvents = async (
	sqsClient: SQSClient,
	queueUrl: string,
	events: IndexEvent[],
): Promise<void> => {
	if (events.length === 0) return;

	for (let i = 0; i < events.length; i += SQS_BATCH_SIZE) {
		const batch = events.slice(i, i + SQS_BATCH_SIZE);
		await sqsClient.send(
			new SendMessageBatchCommand({
				QueueUrl: queueUrl,
				Entries: batch.map((event, idx) => ({
					Id: `${i + idx}`,
					MessageBody: JSON.stringify(event),
				})),
			}),
		);
	}
};
