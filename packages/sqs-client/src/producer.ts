import {
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import type {
	FifoQueueMessage,
	GroupedQueueMessage,
	QueueBatchResult,
	QueueMessage,
	QueueProducer,
} from "@remit/data-ports";
import { resolveSqsCredentials, type SqsStaticCredentials } from "./index.js";

export interface CreateSqsClientOptions {
	readonly queueUrl: string;
	readonly endpoint?: string;
	readonly env?: NodeJS.ProcessEnv;
	/**
	 * Credentials to use when the queue URL resolves to a local endpoint. A
	 * local queue server ignores them, but the SDK still needs something to
	 * sign with and a self-hosted stack has no credential chain to fall back on.
	 */
	readonly localCredentials?: SqsStaticCredentials;
	readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a queue URL addresses a local, SQS-compatible queue server
 * (ElasticMQ, the queue sidecar) rather than real SQS.
 *
 * Any plain `http://` URL is local: real SQS and Scaleway M&Q are always
 * HTTPS, and a self-hosted stack addresses its queue server by container name
 * (`http://queue:9324/...`), not by `localhost`. Over HTTPS only a loopback
 * host is local, which covers a local server behind TLS.
 *
 * The URL is parsed rather than prefix-matched. Prefix-matching the string
 * gets the interesting cases wrong in both directions: it reads
 * `https://localhost.example.com` and `https://localhost@example.com` as
 * local (the host is neither), and misses `https://user:pass@localhost` and
 * an uppercase `HTTP://` scheme (both of which are).
 *
 * A queue URL that does not parse is treated as remote. It cannot be sent to
 * either way, and several callers build their client at module load — throwing
 * here would take a worker down at import instead of surfacing the bad
 * configuration at the send that actually uses it.
 */
export const isLocalEndpoint = (queueUrl: string): boolean => {
	let url: URL;
	try {
		url = new URL(queueUrl);
	} catch {
		return false;
	}
	if (url.protocol === "http:") return true;
	return url.protocol === "https:" && LOOPBACK_HOSTNAMES.has(url.hostname);
};

/**
 * Producer-side counterpart of `runQueuePoller`: the one place an
 * SQS-compatible client is constructed for sending. A queue URL that points at
 * a local endpoint (ElasticMQ) gets its origin as the SDK endpoint and the
 * query protocol ElasticMQ speaks; real SQS and Scaleway M&Q resolve their own
 * endpoint and ride the default credential chain unless
 * `SQS_ACCESS_KEY_ID`/`SQS_SECRET_ACCESS_KEY` are present.
 */
export const createSqsClient = (options: CreateSqsClientOptions): SQSClient => {
	const { queueUrl, endpoint, env, localCredentials } = options;
	const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const local = isLocalEndpoint(queueUrl);
	return new SQSClient({
		requestHandler: { requestTimeout, throwOnRequestTimeout: true },
		endpoint: endpoint ?? (local ? new URL(queueUrl).origin : undefined),
		...(local && { protocol: AwsQueryProtocol }),
		credentials:
			(local ? localCredentials : undefined) ?? resolveSqsCredentials(env),
	});
};

const isFifoQueue = (queueUrl: string): boolean => queueUrl.endsWith(".fifo");

const isGrouped = <T>(
	message: QueueMessage<T>,
): message is GroupedQueueMessage<T> =>
	"groupId" in message && typeof message.groupId === "string";

const isDeduplicated = <T>(
	message: QueueMessage<T>,
): message is FifoQueueMessage<T> =>
	isGrouped(message) &&
	"deduplicationId" in message &&
	typeof message.deduplicationId === "string";

/**
 * The SQS adapter for the `QueueProducer` port. A FIFO queue (`.fifo`) gets
 * the message group, and the deduplication id when the message carries one
 * (otherwise the queue deduplicates by content); a standard queue rejects
 * both, so they are left off. A local queue server (ElasticMQ) does not honour
 * a per-message delay on its FIFO queues, so the delay is dropped there.
 */
export const createQueueProducer = <
	T,
	M extends QueueMessage<T> = QueueMessage<T>,
>(
	options: CreateSqsClientOptions,
): QueueProducer<T, M> => {
	const { queueUrl } = options;
	const client = createSqsClient(options);
	const fifo = isFifoQueue(queueUrl);
	const local = isLocalEndpoint(queueUrl);
	const attributes = (message: M) => ({
		...(fifo && isGrouped(message) && { MessageGroupId: message.groupId }),
		...(fifo &&
			isDeduplicated(message) && {
				MessageDeduplicationId: message.deduplicationId,
			}),
		...(message.delaySeconds &&
			!local && { DelaySeconds: message.delaySeconds }),
	});

	return {
		send: async (message) => {
			await client.send(
				new SendMessageCommand({
					QueueUrl: queueUrl,
					MessageBody: JSON.stringify(message.body),
					...attributes(message),
				}),
			);
		},
		sendBatch: async (messages): Promise<QueueBatchResult> => {
			const result = await client.send(
				new SendMessageBatchCommand({
					QueueUrl: queueUrl,
					Entries: messages.map((message, index) => ({
						Id: `${index}`,
						MessageBody: JSON.stringify(message.body),
						...attributes(message),
					})),
				}),
			);
			return {
				refused: new Set(
					(result.Failed ?? []).map((entry) => Number(entry.Id)),
				),
			};
		},
	};
};
