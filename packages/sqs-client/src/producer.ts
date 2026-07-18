import { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { resolveSqsCredentials } from "./index.js";

export interface CreateQueueProducerOptions {
	readonly queueUrl: string;
	readonly endpoint?: string;
	readonly env?: NodeJS.ProcessEnv;
}

const isLocalEndpoint = (queueUrl: string): boolean =>
	queueUrl.startsWith("http://") || queueUrl.startsWith("https://localhost");

/**
 * Producer-side counterpart of `runQueuePoller`: the one place an
 * SQS-compatible client is constructed for sending. A queue URL that points at
 * a local endpoint (ElasticMQ) gets its origin as the SDK endpoint and the
 * query protocol ElasticMQ speaks; real SQS and Scaleway M&Q resolve their own
 * endpoint and ride the default credential chain unless
 * `SQS_ACCESS_KEY_ID`/`SQS_SECRET_ACCESS_KEY` are present.
 */
export const createQueueProducer = (
	options: CreateQueueProducerOptions,
): SQSClient => {
	const { queueUrl, endpoint, env } = options;
	const local = isLocalEndpoint(queueUrl);
	return new SQSClient({
		endpoint: endpoint ?? (local ? new URL(queueUrl).origin : undefined),
		...(local && { protocol: AwsQueryProtocol }),
		credentials: resolveSqsCredentials(env),
	});
};
