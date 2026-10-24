import type {
	CreateFilterInput,
	UpdateFilterInput,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import {
	authenticatedUserFromEvent,
	getAccountConfigIdFromEvent,
} from "../auth.js";
import { getClient } from "../service/data-client.js";
import {
	createFilter,
	listFilters,
	toFilterResponse,
	updateFilter,
} from "../service/filters.js";
import { unwrap } from "../service/outcome.js";
import type {
	FilterDetailOperationIds,
	FilterOperationIds,
	OperationHandler,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

export const FilterOperations: Record<
	FilterOperationIds,
	OperationHandler<FilterOperationIds>
> = {
	FilterOperations_listFilters: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		return unwrap(
			await listFilters(await getClient(), authenticatedUserFromEvent(event), {
				accountId,
				continuationToken,
			}),
		);
	},

	FilterOperations_createFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const { accountId } = context.request.params as { accountId: string };
		const filter = context.request.requestBody as CreateFilterInput;

		return unwrap(
			await createFilter(await getClient(), authenticatedUserFromEvent(event), {
				accountId,
				filter,
			}),
		);
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
		assertAccountOwnership(account, accountConfigId, "read");

		const { filter } = client;
		const item = await filter.get(accountConfigId, filterId);
		const refreshed = await filter.refreshExpiry(item);
		return toFilterResponse(refreshed);
	},

	FilterDetailOperations_updateFilter: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const { accountId, filterId } = context.request.params as {
			accountId: string;
			filterId: string;
		};
		const patch = context.request.requestBody as Partial<UpdateFilterInput>;

		return unwrap(
			await updateFilter(await getClient(), authenticatedUserFromEvent(event), {
				accountId,
				filterId,
				patch,
			}),
		);
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
		assertAccountOwnership(account, accountConfigId, "act");

		const { filter } = client;
		await filter.delete(accountConfigId, filterId);
		return { statusCode: 204 };
	},
};
