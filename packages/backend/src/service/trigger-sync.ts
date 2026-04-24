import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

interface SyncMailboxesEvent {
	type: "SYNC_MAILBOXES";
	eventId: string;
	timestamp: number;
	accountId: string;
}

interface TriggerAccountSyncInput {
	sqsClient: SQSClient;
	queueUrl: string;
	accountId: string;
}

const isFifoQueue = (queueUrl: string): boolean => queueUrl.endsWith(".fifo");

export const buildSyncMailboxesCommand = (
	input: TriggerAccountSyncInput,
): SendMessageCommand => {
	const { queueUrl, accountId } = input;
	const event: SyncMailboxesEvent = {
		type: "SYNC_MAILBOXES",
		eventId: randomUUID(),
		timestamp: Date.now(),
		accountId,
	};

	const useFifo = isFifoQueue(queueUrl);

	return new SendMessageCommand({
		QueueUrl: queueUrl,
		MessageBody: JSON.stringify(event),
		...(useFifo && {
			MessageGroupId: accountId,
			MessageDeduplicationId: `SYNC_MAILBOXES:${accountId}`,
		}),
	});
};

export const triggerAccountSync = async (
	input: TriggerAccountSyncInput,
): Promise<{ eventId: string }> => {
	const command = buildSyncMailboxesCommand(input);
	await input.sqsClient.send(command);
	const body = command.input.MessageBody ?? "{}";
	const parsed = JSON.parse(body) as SyncMailboxesEvent;
	return { eventId: parsed.eventId };
};
