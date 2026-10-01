import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { OrganizeJobRequestItem } from "@remit/data-ports";
import { logger } from "@remit/logger-lambda";
import { NO_ACTION } from "@remit/mailbox-service";
import { env } from "expect-env";
import type { RemitClient } from "./data-client.js";
import type { OrganizePredicate } from "./organize.js";
import { sqsClient } from "./sqs.js";

/**
 * How long a finished (or abandoned) job row lingers before the table-wide TTL
 * reclaims it (RFC 034 Decision 1). A back-apply runs once and needs no standing
 * lifetime; a week is ample for a client to poll the result.
 */
const ORGANIZE_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface OrganizeJobRequest {
	accountConfigId: string;
	userId: string;
	predicate: OrganizePredicate;
	/** The standing filter this job runs, or omitted for an "all like these" pass. */
	filterId?: string;
}

/**
 * Write a Pending job row and hand it to the account-fanout worker. Every
 * back-apply goes through here: "all like these", a new filter's first pass,
 * and Run now on a saved filter.
 */
export const queueOrganizeJob = async (
	client: Pick<RemitClient, "organizeJobRequest">,
	request: OrganizeJobRequest,
): Promise<OrganizeJobRequestItem> => {
	const { accountConfigId, userId, predicate } = request;
	const filterId = request.filterId ?? NO_ACTION;
	const job = await client.organizeJobRequest.create({
		accountConfigId,
		userId,
		filterId,
		anchorMessageId: predicate.anchorMessageId,
		matchOperator: predicate.matchOperator,
		literalClauses: predicate.literalClauses,
		similarityThreshold: predicate.similarityThreshold,
		actionLabelId: predicate.actionLabelId,
		actionMailboxId: predicate.actionMailboxId,
		ttl: Math.floor(Date.now() / 1000) + ORGANIZE_JOB_TTL_SECONDS,
	});

	await sqsClient.send(
		new SendMessageCommand({
			QueueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
			MessageBody: JSON.stringify({
				type: "OrganizeJob",
				accountConfigId,
				organizeJobId: job.organizeJobId,
			}),
		}),
	);

	// biome-ignore lint/plugin/no-logger-info: a back-apply is an audit-grade signal
	logger.info(
		{ accountConfigId, organizeJobId: job.organizeJobId, filterId },
		"Organize back-apply job initiated",
	);
	return job;
};
