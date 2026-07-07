import { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { resolveSqsCredentials } from "@remit/sqs-client";
import { env } from "expect-env";

const queueUrl = env.SQS_QUEUE_URL;
const isLocal = queueUrl.startsWith("http://localhost");

export const sqsClient = new SQSClient({
	endpoint: isLocal ? new URL(queueUrl).origin : undefined,
	...(isLocal && { protocol: AwsQueryProtocol }),
	credentials: resolveSqsCredentials(),
});
