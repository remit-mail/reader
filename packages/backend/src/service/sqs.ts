import { createQueueProducer } from "@remit/sqs-client/producer";
import { env } from "expect-env";

export const sqsClient = createQueueProducer({ queueUrl: env.SQS_QUEUE_URL });
