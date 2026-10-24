import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { OrganizeJobRequestItem } from "@remit/data-ports";
import { logger } from "@remit/logger-lambda";
import {
	type OrganizeJobDeps,
	organizeJobMessage,
} from "@remit/mailbox-service";
import { env } from "expect-env";
import type { RemitClient } from "./data-client.js";
import { sqsClient } from "./sqs.js";

const dispatchOrganizeJob = async (
	job: OrganizeJobRequestItem,
): Promise<void> => {
	await sqsClient.send(
		new SendMessageCommand({
			QueueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
			MessageBody: JSON.stringify(organizeJobMessage(job)),
		}),
	);

	// biome-ignore lint/plugin/no-logger-info: a back-apply is an audit-grade signal
	logger.info(
		{
			accountConfigId: job.accountConfigId,
			organizeJobId: job.organizeJobId,
			filterId: job.filterId,
		},
		"Organize back-apply job initiated",
	);
};

export const organizeJobDeps = (
	client: Pick<RemitClient, "organizeJobRequest">,
): OrganizeJobDeps => ({
	organizeJobRequest: client.organizeJobRequest,
	dispatchOrganizeJob,
});
