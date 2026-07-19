import { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { resolveSqsCredentials, type SqsStaticCredentials } from "./index.js";

export interface CreateQueueProducerOptions {
	readonly queueUrl: string;
	readonly endpoint?: string;
	readonly env?: NodeJS.ProcessEnv;
	/**
	 * Credentials to use when the queue URL resolves to a local endpoint. A
	 * local queue server ignores them, but the SDK still needs something to
	 * sign with and a self-hosted stack has no credential chain to fall back on.
	 */
	readonly localCredentials?: SqsStaticCredentials;
}

/**
 * Whether a queue URL addresses a local, SQS-compatible queue server
 * (ElasticMQ, the queue sidecar) rather than real SQS.
 *
 * Any plain `http://` URL is local: real SQS and Scaleway M&Q are always
 * HTTPS, and a self-hosted stack addresses its queue server by container name
 * (`http://queue:9324/...`), not by `localhost`. The `https://localhost` case
 * covers a local server behind TLS.
 */
export const isLocalEndpoint = (queueUrl: string): boolean =>
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
	const { queueUrl, endpoint, env, localCredentials } = options;
	const local = isLocalEndpoint(queueUrl);
	return new SQSClient({
		endpoint: endpoint ?? (local ? new URL(queueUrl).origin : undefined),
		...(local && { protocol: AwsQueryProtocol }),
		credentials:
			(local ? localCredentials : undefined) ?? resolveSqsCredentials(env),
	});
};
