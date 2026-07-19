import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type {
	CreateOrganizeJobResponse,
	OrganizeInput,
	OrganizeJobResponse,
	OrganizePreviewResponse,
} from "@remit/api-openapi-types";
import { NotFoundError } from "@remit/data-ports/errors";
import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { getClient, type RemitClient } from "../service/dynamodb.js";
import {
	buildOrganizeMatchDeps,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizePredicate,
} from "../service/organize.js";
import { sqsClient } from "../service/sqs.js";
import type {
	OperationHandler,
	OrganizeJobDetailOperationIds,
	OrganizeOperationIds,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

const NONE = "None";

/**
 * How long a finished (or abandoned) job row lingers before the table-wide TTL
 * reclaims it (RFC 034 Decision 1). A back-apply runs once and needs no standing
 * lifetime; a week is ample for a client to poll the result.
 */
const ORGANIZE_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Normalize the request body into the flattened predicate the job row and the
 * matcher share. `anchorMessageId` collapses to the `"None"` sentinel when
 * absent, and `similarityThreshold` to the server default — the persisted entity
 * carries no optional fields (RFC 032).
 */
export const predicateFromInput = (
	input: OrganizeInput,
): OrganizePredicate => ({
	anchorMessageId: input.anchorMessageId ?? NONE,
	matchOperator: input.matchOperator,
	literalClauses: input.literalClauses,
	similarityThreshold: input.similarityThreshold ?? 0.75,
	actionLabelId: input.actionLabelId,
	actionMailboxId: input.actionMailboxId,
});

const assertAccount = async (
	client: RemitClient,
	accountId: string,
	accountConfigId: string,
	mode: "read" | "act",
): Promise<void> => {
	const account = await client.account.get(accountId);
	assertAccountOwnership(account, accountConfigId, mode);
};

const toOrganizeJobResponse = (
	job: Awaited<ReturnType<RemitClient["organizeJobRequest"]["get"]>>,
): OrganizeJobResponse => ({
	organizeJobId: job.organizeJobId,
	accountConfigId: job.accountConfigId,
	userId: job.userId,
	state: job.state,
	anchorMessageId: job.anchorMessageId,
	matchOperator: job.matchOperator,
	literalClauses: job.literalClauses,
	similarityThreshold: job.similarityThreshold,
	actionLabelId: job.actionLabelId,
	actionMailboxId: job.actionMailboxId,
	matchedCount: job.matchedCount,
	appliedCount: job.appliedCount,
	failedCount: job.failedCount,
	errorMessage: job.errorMessage,
	createdAt: job.createdAt,
	updatedAt: job.updatedAt,
});

export const OrganizeOperations: Record<
	OrganizeOperationIds,
	OperationHandler<OrganizeOperationIds>
> = {
	OrganizeOperations_createOrganizeJob: async (
		context: Context,
		...args: unknown[]
	): Promise<CreateOrganizeJobResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as OrganizeInput;

		const userId = getSubFromEvent(event);
		if (!userId) {
			throw new Error(
				"Missing Cognito `sub`: cannot attribute an organize job to a user",
			);
		}

		const client = await getClient();
		await assertAccount(client, accountId, accountConfigId, "act");

		const predicate = predicateFromInput(input);
		const ttl = Math.floor(Date.now() / 1000) + ORGANIZE_JOB_TTL_SECONDS;

		const job = await client.organizeJobRequest.create({
			accountConfigId,
			userId,
			anchorMessageId: predicate.anchorMessageId,
			matchOperator: predicate.matchOperator,
			literalClauses: predicate.literalClauses,
			similarityThreshold: predicate.similarityThreshold,
			actionLabelId: predicate.actionLabelId,
			actionMailboxId: predicate.actionMailboxId,
			ttl,
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
			{ accountConfigId, organizeJobId: job.organizeJobId },
			"Organize back-apply job initiated",
		);

		return {
			statusCode: 202,
			organizeJobId: job.organizeJobId,
			state: job.state,
		};
	},

	OrganizeOperations_previewOrganize: async (
		context: Context,
		...args: unknown[]
	): Promise<OrganizePreviewResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as OrganizeInput;

		const client = await getClient();
		await assertAccount(client, accountId, accountConfigId, "read");

		const messageIds = await matchOrganize(
			buildOrganizeMatchDeps(client),
			accountConfigId,
			predicateFromInput(input),
			ORGANIZE_MATCH_LIMIT,
		);

		return { matchedCount: messageIds.length, messageIds };
	},
};

export const OrganizeJobDetailOperations: Record<
	OrganizeJobDetailOperationIds,
	OperationHandler<OrganizeJobDetailOperationIds>
> = {
	OrganizeJobDetailOperations_getOrganizeJob: async (
		context: Context,
		...args: unknown[]
	): Promise<OrganizeJobResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, organizeJobId } = context.request.params as {
			accountId: string;
			organizeJobId: string;
		};

		const client = await getClient();
		await assertAccount(client, accountId, accountConfigId, "read");

		const job = await client.organizeJobRequest.get(organizeJobId);
		if (job.accountConfigId !== accountConfigId) {
			throw new NotFoundError(`Organize job not found: ${organizeJobId}`);
		}

		return toOrganizeJobResponse(job);
	},
};
