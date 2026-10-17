import {
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { type AwsClientStub, mockClient } from "aws-sdk-client-mock";

export interface QueuedEvent {
	queueUrl: string;
	body: Record<string, unknown>;
}

let stub: AwsClientStub<SQSClient> | undefined;

/**
 * Every SQS send from here on, answered by `answer` instead of the wire. One
 * stub per process: a second capture starts from an empty record.
 */
export const captureQueue = () => {
	stub ??= mockClient(SQSClient);
	const sqs = stub;
	sqs.reset();
	const sent: QueuedEvent[] = [];
	let answer: () => Promise<unknown> = async () => ({});
	const record = (
		queueUrl: string | undefined,
		bodies: Array<string | undefined>,
	) => {
		for (const body of bodies) {
			sent.push({ queueUrl: queueUrl ?? "", body: JSON.parse(body ?? "{}") });
		}
		return answer();
	};
	sqs
		.on(SendMessageCommand)
		.callsFake((input) => record(input.QueueUrl, [input.MessageBody]));
	sqs.on(SendMessageBatchCommand).callsFake((input) =>
		record(
			input.QueueUrl,
			(input.Entries ?? []).map(
				(entry: { MessageBody?: string }) => entry.MessageBody,
			),
		),
	);
	return {
		sent,
		inputs: () =>
			sqs.commandCalls(SendMessageCommand).map((call) => call.args[0].input),
		answer: (next: () => Promise<unknown>) => {
			answer = next;
		},
		restore: () => sqs.reset(),
	};
};

export type QueueCapture = ReturnType<typeof captureQueue>;
