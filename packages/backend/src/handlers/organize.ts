import type {
	CreateOrganizeJobResponse,
	OrganizeInput,
	OrganizeJobResponse,
	OrganizePreviewResponse,
} from "@remit/api-openapi-types";
import { BadRequestError, NotFoundError } from "@remit/data-ports/errors";
import { logger } from "@remit/logger";
import {
	type OrganizeJobRequest,
	ownedAccount,
	queueOrganizeJob,
} from "@remit/mailbox-service";
import { env } from "expect-env";
import type { Context } from "openapi-backend";
import type { RemitClient } from "../service/data-client.js";
import {
	buildOrganizeMatchDeps,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizePredicate,
	organizePredicateRejection,
} from "../service/organize.js";
import { unwrap } from "../service/refusal.js";
import type {
	HandlerContext,
	OperationHandler,
	OrganizeJobDetailOperationIds,
	OrganizeOperationIds,
} from "../types.js";

/**
 * Normalize the request body into the flattened predicate the job row and the
 * matcher share.
 */
export const predicateFromInput = (
	input: OrganizeInput,
): OrganizePredicate => ({
	matchOperator: input.matchOperator,
	literalClauses: input.literalClauses,
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
	unwrap(ownedAccount(account, accountConfigId, mode));
};

const toOrganizeJobResponse = (
	job: Awaited<ReturnType<RemitClient["organizeJobRequest"]["get"]>>,
): OrganizeJobResponse => ({
	organizeJobId: job.organizeJobId,
	accountConfigId: job.accountConfigId,
	userId: job.userId,
	state: job.state,
	filterId: job.filterId,
	matchOperator: job.matchOperator,
	literalClauses: job.literalClauses,
	actionLabelId: job.actionLabelId,
	actionMailboxId: job.actionMailboxId,
	matchedCount: job.matchedCount,
	appliedCount: job.appliedCount,
	failedCount: job.failedCount,
	errorMessage: job.errorMessage,
	createdAt: job.createdAt,
	updatedAt: job.updatedAt,
});

/**
 * What a create asks the worker to run. A saved filter is named and read when
 * the job runs, so Run now and a filter's create share one path (#1354); an
 * "all like these" predicate the matcher can never honour is answered here,
 * not with a 202 the worker has to fail later (reader #463).
 */
const requestedJob = async (
	client: RemitClient,
	owner: { accountConfigId: string; userId: string },
	input: OrganizeInput,
): Promise<OrganizeJobRequest> => {
	if (input.filterId) {
		await client.filter.get(owner.accountConfigId, input.filterId);
		return { ...owner, filterId: input.filterId };
	}
	const predicate = predicateFromInput(input);
	const rejection = organizePredicateRejection(predicate);
	if (rejection) throw new BadRequestError(rejection.message);
	return { ...owner, predicate };
};

export const OrganizeOperations: Record<
	OrganizeOperationIds,
	OperationHandler<OrganizeOperationIds>
> = {
	OrganizeOperations_createOrganizeJob: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<CreateOrganizeJobResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as OrganizeInput;

		const userId = ctx.identity.sub;

		const client = ctx.client;
		await assertAccount(client, accountId, accountConfigId, "act");

		const job = await queueOrganizeJob(
			{
				organizeJobRequest: client.organizeJobRequest,
				sqsQueueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
				logger,
			},
			await requestedJob(client, { accountConfigId, userId }, input),
		);

		return {
			statusCode: 202,
			organizeJobId: job.organizeJobId,
			state: job.state,
		};
	},

	OrganizeOperations_previewOrganize: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<OrganizePreviewResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as OrganizeInput;

		const client = ctx.client;
		await assertAccount(client, accountId, accountConfigId, "read");

		if (input.filterId) {
			throw new BadRequestError(
				"Preview takes a rule, not a saved filter. Run the filter to apply it.",
			);
		}
		const result = await matchOrganize(
			buildOrganizeMatchDeps(client),
			accountConfigId,
			predicateFromInput(input),
			ORGANIZE_MATCH_LIMIT,
		);
		if (result.rejected) throw new BadRequestError(result.rejected.message);

		return {
			matchedCount: result.messageIds.length,
			messageIds: result.messageIds,
		};
	},
};

export const OrganizeJobDetailOperations: Record<
	OrganizeJobDetailOperationIds,
	OperationHandler<OrganizeJobDetailOperationIds>
> = {
	OrganizeJobDetailOperations_getOrganizeJob: async (
		context: Context,
		ctx: HandlerContext,
	): Promise<OrganizeJobResponse> => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId, organizeJobId } = context.request.params as {
			accountId: string;
			organizeJobId: string;
		};

		const client = ctx.client;
		await assertAccount(client, accountId, accountConfigId, "read");

		const job = await client.organizeJobRequest.get(organizeJobId);
		if (job.accountConfigId !== accountConfigId) {
			throw new NotFoundError(`Organize job not found: ${organizeJobId}`);
		}

		return toOrganizeJobResponse(job);
	},
};
