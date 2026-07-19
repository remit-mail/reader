import type { SQSClient } from "@aws-sdk/client-sqs";
import { createQueueProducer } from "@remit/sqs-client/producer";

/**
 * An SQS client for the search-index queue that works against both a local
 * queue server (dev / e2e / the vps stack) and real SQS.
 */
export const createSqsClient = (queueUrl: string): SQSClient =>
	createQueueProducer({
		queueUrl,
		localCredentials: { accessKeyId: "local", secretAccessKey: "local" },
	});
