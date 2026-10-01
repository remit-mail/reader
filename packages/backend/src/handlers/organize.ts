import type {
	CreateOrganizeJobResponse,
	OrganizeInput,
	OrganizeJobResponse,
	OrganizePreviewResponse,
} from "@remit/api-openapi-types";
import { BadRequestError, NotFoundError } from "@remit/data-ports/errors";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { getClient, type RemitClient } from "../service/data-client.js";
import {
	buildOrganizeMatchDeps,
	loadFilterBackApply,
	matchFilterInbox,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizeMatchResult,
	type OrganizePredicate,
	organizePredicateRejection,
} from "../service/organize.js";
import { queueOrganizeJob } from "../service/organize-queue.js";
import type {
	OperationHandler,
	OrganizeJobDetailOperationIds,
	OrganizeOperationIds,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

const NONE = "None";

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
	filterId: job.filterId,
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

/**
 * The predicate a request asks for: the body's own, or the named standing
 * filter's. A rule the matcher can never honour is answered here, not with a
 * 202 the worker has to fail later (reader #463).
 */
const requestedPredicate = async (
	client: RemitClient,
	accountConfigId: string,
	input: OrganizeInput,
): Promise<OrganizePredicate> => {
	if (input.filterId) {
		const loaded = await loadFilterBackApply(
			client,
			accountConfigId,
			input.filterId,
		);
		if (loaded.rejected) throw new BadRequestError(loaded.rejected.message);
		return loaded.predicate;
	}
	const predicate = predicateFromInput(input);
	const rejection = organizePredicateRejection(predicate);
	if (rejection) throw new BadRequestError(rejection.message);
	return predicate;
};

const previewMatch = async (
	client: RemitClient,
	accountConfigId: string,
	input: OrganizeInput,
): Promise<OrganizeMatchResult> => {
	const deps = buildOrganizeMatchDeps(client);
	if (!input.filterId) {
		return matchOrganize(
			deps,
			accountConfigId,
			predicateFromInput(input),
			ORGANIZE_MATCH_LIMIT,
		);
	}
	const loaded = await loadFilterBackApply(
		client,
		accountConfigId,
		input.filterId,
	);
	if (loaded.rejected) return loaded;
	return matchFilterInbox(client, deps, accountConfigId, loaded);
};

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

		const predicate = await requestedPredicate(client, accountConfigId, input);
		const job = await queueOrganizeJob(client, {
			accountConfigId,
			userId,
			predicate,
			filterId: input.filterId,
		});

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

		const result = await previewMatch(client, accountConfigId, input);
		if (result.rejected) throw new BadRequestError(result.rejected.message);

		const response: OrganizePreviewResponse = {
			matchedCount: result.messageIds.length,
			messageIds: result.messageIds,
		};
		if (result.semanticUnavailable) response.semanticUnavailable = true;
		if (result.semanticIndexEmpty) response.semanticIndexEmpty = true;
		return response;
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
