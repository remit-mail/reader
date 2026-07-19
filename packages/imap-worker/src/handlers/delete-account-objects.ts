import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { Logger } from "@remit/logger-lambda";
import { createQueueProducer } from "@remit/sqs-client/producer";
import { env } from "expect-env";

export interface DeleteAccountObjectsEvent {
	type: "DELETE_ACCOUNT_OBJECTS";
	accountConfigId: string;
	continuationToken?: string;
}

const s3 = new S3Client({});

const sqsQueueUrl = env.SQS_QUEUE_URL_MESSAGE_MGMT;
const sqs = createQueueProducer({ queueUrl: sqsQueueUrl });

const BATCH_SIZE = 1_000;
const MIN_REMAINING_MS = 30_000;

export const handleDeleteAccountObjects = async (
	event: DeleteAccountObjectsEvent,
	log: Logger,
	getRemainingTimeMs?: () => number,
): Promise<void> => {
	const BUCKET_NAME = env.S3_BUCKET_NAME;
	const { accountConfigId, continuationToken } = event;
	const prefix = `accounts/${accountConfigId}/`;

	log.info(
		{ accountConfigId, prefix, hasContinuation: !!continuationToken },
		"Deleting account objects from S3",
	);

	let currentToken = continuationToken;
	let totalDeleted = 0;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		// Check remaining time before starting a new page
		if (getRemainingTimeMs && getRemainingTimeMs() < MIN_REMAINING_MS) {
			log.info(
				{ accountConfigId, totalDeleted, continuationToken: currentToken },
				"Near timeout, re-enqueuing with continuation token",
			);
			await reenqueue(accountConfigId, currentToken);
			return;
		}

		const listResult = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET_NAME,
				Prefix: prefix,
				MaxKeys: BATCH_SIZE,
				ContinuationToken: currentToken,
			}),
		);

		const keys = (listResult.Contents ?? [])
			.map((obj) => obj.Key)
			.filter((k): k is string => k !== undefined);

		if (keys.length > 0) {
			await s3.send(
				new DeleteObjectsCommand({
					Bucket: BUCKET_NAME,
					Delete: {
						Objects: keys.map((Key) => ({ Key })),
						Quiet: true,
					},
				}),
			);
			totalDeleted += keys.length;
		}

		if (!listResult.IsTruncated) {
			break;
		}

		currentToken = listResult.NextContinuationToken;
	}

	log.info(
		{ accountConfigId, totalDeleted },
		"Finished deleting account objects",
	);
};

const reenqueue = async (
	accountConfigId: string,
	continuationToken: string | undefined,
): Promise<void> => {
	const event: DeleteAccountObjectsEvent = {
		type: "DELETE_ACCOUNT_OBJECTS",
		accountConfigId,
		continuationToken,
	};

	await sqs.send(
		new SendMessageCommand({
			QueueUrl: sqsQueueUrl,
			MessageBody: JSON.stringify(event),
		}),
	);
};
