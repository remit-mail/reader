import { SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { resolveSqsCredentials } from "@remit/sqs-client";

/**
 * An SQS client for the search-index queue that works against both a local
 * ElasticMQ endpoint (dev / e2e / the vps stack) and real SQS. Identical to the
 * per-worker helpers this replaces.
 */
export const createSqsClient = (queueUrl: string): SQSClient => {
	const isLocal = queueUrl.startsWith("http://localhost");
	return new SQSClient({
		endpoint: isLocal ? new URL(queueUrl).origin : undefined,
		...(isLocal
			? {
					protocol: AwsQueryProtocol,
					credentials: { accessKeyId: "local", secretAccessKey: "local" },
				}
			: { credentials: resolveSqsCredentials() }),
	});
};
