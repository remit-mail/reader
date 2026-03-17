import type { AddressItem } from "@remit/remit-electrodb-service";
import type { AddressResponse } from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getClient } from "../service/dynamodb.js";
import type { AddressOperationIds, OperationHandler } from "../types.js";

const getAccountConfigIdFromEvent = (event: APIGatewayProxyEvent): string => {
	const claims = event.requestContext?.authorizer?.claims;
	if (claims?.["custom:accountConfigId"]) {
		return claims["custom:accountConfigId"] as string;
	}

	const localAccountConfigId = process.env.LOCAL_ACCOUNT_CONFIG_ID;
	if (localAccountConfigId) {
		return localAccountConfigId;
	}

	throw new Error(
		"Missing accountConfigId: not found in JWT claims or LOCAL_ACCOUNT_CONFIG_ID env var",
	);
};

const toAddressResponse = (item: AddressItem): AddressResponse => ({
	addressId: item.addressId,
	accountConfigId: item.accountConfigId,
	displayName: item.displayName,
	localPart: item.localPart,
	domain: item.domain,
	normalizedEmail: item.normalizedEmail,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

export const AddressOperations: Record<
	AddressOperationIds,
	OperationHandler<AddressOperationIds>
> = {
	AddressOperations_searchAddresses: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { q, limit } = context.request.query as {
			q: string;
			limit?: number;
		};

		const client = getClient();

		const result = await client.address.listByAccountConfig({
			accountConfigId,
			normalizedCompound: q.toLowerCase(),
			limit: limit ?? 10,
		});

		return {
			items: result.items.map(toAddressResponse),
			continuationToken: result.continuationToken,
		};
	},
};
