import type {
	CreateFilterInput,
	CreateFilterResponse,
	FilterResponse,
	UpdateFilterInput,
} from "@remit/api-openapi-types";
import type { FilterItem } from "@remit/data-ports";
import { logger } from "@remit/logger";
import {
	createFilter,
	listFilters,
	ownedAccount,
	updateFilter,
} from "@remit/mailbox-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import { getAccountConfigIdFromEvent, getSubFromEvent } from "../auth.js";
import { getClient } from "../service/data-client.js";
import { unwrap } from "../service/refusal.js";
import type {
	FilterDetailOperationIds,
	FilterOperationIds,
	OperationHandler,
} from "../types.js";

const toFilterResponse = (item: FilterItem): FilterResponse => ({
	filterId: item.filterId,
	accountConfigId: item.accountConfigId,
	name: item.name,
	scope: item.scope,
	expiresAt: item.expiresAt,
	state: item.state,
	disabledReason: item.disabledReason,
	ruleChangedAt: item.ruleChangedAt,
	actionChangedAt: item.actionChangedAt,
	matchOperator: item.matchOperator,
	literalClauses: item.literalClauses,
	actionLabelId: item.actionLabelId,
	actionMailboxId: item.actionMailboxId,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

const requireUserId = (event: APIGatewayProxyEvent): string => {
	const userId = getSubFromEvent(event);
	if (!userId) {
		throw new Error(
			"Missing Cognito `sub`: cannot attribute an organize job to a user",
		);
	}
	return userId;
};

export const FilterOperations: Record<
	FilterOperationIds,
	OperationHandler<FilterOperationIds>
> = {
	FilterOperations_listFilters: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const page = unwrap(
			await listFilters(await getClient(), accountConfigId, {
				accountId,
				continuationToken,
			}),
		);
		return {
			items: page.items.map(toFilterResponse),
			continuationToken: page.continuationToken,
		};
	},

	FilterOperations_createFilter: async (
		context,
		...args: unknown[]
	): Promise<CreateFilterResponse> => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const filter = context.request.requestBody as CreateFilterInput;
		const userId = requireUserId(event);

		const client = await getClient();
		const created = unwrap(
			await createFilter(
				{
					account: client.account,
					mailbox: client.mailbox,
					filter: client.filter,
					organizeJobRequest: client.organizeJobRequest,
					sqsQueueUrl: env.SQS_QUEUE_URL_ACCOUNT_FANOUT,
					logger,
				},
				{ accountConfigId, userId },
				{ accountId, filter },
			),
		);
		return {
			...toFilterResponse(created.filter),
			organizeJobId: created.organizeJob.organizeJobId,
		};
	},
};

export const FilterDetailOperations: Record<
	FilterDetailOperationIds,
	OperationHandler<FilterDetailOperationIds>
> = {
	FilterDetailOperations_getFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		unwrap(ownedAccount(account, accountConfigId, "read"));

		const { filter } = client;
		const item = await filter.get(accountConfigId, filterId);
		const refreshed = await filter.refreshExpiry(item);
		return toFilterResponse(refreshed);
	},

	FilterDetailOperations_updateFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};
		const patch = context.request.requestBody as Partial<UpdateFilterInput>;

		const updated = await updateFilter(await getClient(), accountConfigId, {
			accountId,
			filterId,
			patch,
		});
		return toFilterResponse(unwrap(updated));
	},

	FilterDetailOperations_deleteFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		unwrap(ownedAccount(account, accountConfigId, "act"));

		const { filter } = client;
		await filter.delete(accountConfigId, filterId);
		return { statusCode: 204 };
	},
};
