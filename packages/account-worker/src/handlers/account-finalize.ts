import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import type { Logger } from "@remit/logger-lambda";
import type { SQSHandler } from "aws-lambda";
import {
	type InvalidationClient,
	invalidateAccountContent,
} from "../cloudfront-invalidation.js";
import type { AccountFinalizeEvent } from "../events.js";

let _cloudFrontClient: CloudFrontClient | undefined;
const getCloudFrontClient = (): CloudFrontClient => {
	if (!_cloudFrontClient) _cloudFrontClient = new CloudFrontClient({});
	return _cloudFrontClient;
};

export interface ProcessFinalizeDeps {
	cloudFrontClient?: InvalidationClient;
	distributionId?: string;
}

/**
 * Account-erasure finalize step. Today this is the CloudFront cache
 * invalidation introduced for #224 PR 2 / #297 — the underlying entity
 * cascade still runs through the existing stub flow and lands in DLQ
 * until the cascade implementation lands. Invalidation MUST run regardless
 * because it has no DDB / IMAP dependencies and missing it leaves stale
 * cached body parts at the edge for up to the 7-day `maxTtl` even after
 * the rest of the erasure completes.
 */
export const processAccountFinalize = async (
	event: AccountFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
): Promise<void> => {
	const distributionId =
		deps.distributionId ?? process.env.CONTENT_DISTRIBUTION_ID ?? "";
	const client = deps.cloudFrontClient ?? getCloudFrontClient();

	log.info(
		{
			accountConfigId: event.accountConfigId,
			distributionId: distributionId ? "set" : "missing",
		},
		"Invalidating CloudFront cache for erased account",
	);

	await invalidateAccountContent(event.accountConfigId, distributionId, client);

	log.info(
		{ accountConfigId: event.accountConfigId },
		"CloudFront invalidation submitted",
	);
};

export const handler: SQSHandler = async (_event) => {
	throw new Error("Not implemented — stub for CDK synth");
};
