import {
	CloudFrontClient,
	CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

export interface InvalidationClient {
	send(command: CreateInvalidationCommand): Promise<unknown>;
}

let _client: CloudFrontClient | undefined;

const getDefaultClient = (): CloudFrontClient => {
	if (!_client) _client = new CloudFrontClient({});
	return _client;
};

/**
 * Issue a CloudFront cache invalidation that purges all cached objects
 * under the deleted tenant's prefix. Closes #297: without this, edge
 * caches keep stale content for up to the 7-day `maxTtl` after the
 * underlying S3 objects are deleted on account erasure.
 *
 * The path is the same prefix the Lambda@Edge JWT verifier enforces
 * (`/content/accounts/{accountConfigId}/*`), so a single invalidation
 * covers every per-tenant body part. `CallerReference` is set to the
 * accountConfigId + timestamp to make the request idempotent within a
 * single second — CloudFront rejects exact-duplicate references during
 * a short window.
 *
 * Caller must surface CloudFront errors back to SQS so the message is
 * retried; do not swallow them.
 */
export const invalidateAccountContent = async (
	accountConfigId: string,
	distributionId: string,
	client: InvalidationClient = getDefaultClient(),
): Promise<void> => {
	if (!distributionId || distributionId.length === 0) {
		throw new Error(
			"CONTENT_DISTRIBUTION_ID is not set; cannot invalidate CloudFront cache",
		);
	}

	const path = `/content/accounts/${accountConfigId}/*`;
	const callerReference = `account-erase:${accountConfigId}:${Date.now()}`;

	await client.send(
		new CreateInvalidationCommand({
			DistributionId: distributionId,
			InvalidationBatch: {
				CallerReference: callerReference,
				Paths: {
					Quantity: 1,
					Items: [path],
				},
			},
		}),
	);
};
