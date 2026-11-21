import type {
	AddressTrustFlag,
	UpdateAddressInput,
} from "@remit/api-openapi-types";
import type { Context } from "openapi-backend";
import {
	searchAddressesFor,
	updateAddressFor,
} from "../service/mail-action-operations.js";
import type { QueueName } from "../service/queues.js";
import type {
	AddressDetailOperationIds,
	AddressOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";

export const AddressOperations = {
	AddressOperations_searchAddresses: async (
		context: Context,
		ctx: HandlerContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { q, limit, flag } = context.request.query as {
			q: string;
			limit?: number;
			flag?: AddressTrustFlag;
		};

		return searchAddressesFor(ctx.client, accountConfigId, { q, limit, flag });
	},
} satisfies Record<
	AddressOperationIds,
	OperationHandler<AddressOperationIds, QueueName>
>;

export const AddressDetailOperations = {
	AddressDetailOperations_updateAddress: async (
		context: Context,
		ctx: HandlerContext<"accountFanout">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { addressId } = context.request.params as { addressId: string };
		const body = (context.request.requestBody ?? {}) as UpdateAddressInput;
		return updateAddressFor(ctx.client, accountConfigId, addressId, body);
	},
} satisfies Record<
	AddressDetailOperationIds,
	OperationHandler<AddressDetailOperationIds, QueueName>
>;
