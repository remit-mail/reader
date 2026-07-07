import {
	type AddressItem,
	type FlagsMergePatch,
	ForbiddenError,
} from "@remit/remit-electrodb-service";
import type {
	AddressResponse,
	UpdateAddressInput,
} from "@remit/api-openapi-types";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import type {
	AddressDetailOperationIds,
	AddressOperationIds,
	OperationHandler,
} from "../types.js";

export const toAddressResponse = (item: AddressItem): AddressResponse => ({
	addressId: item.addressId,
	accountConfigId: item.accountConfigId,
	displayName: item.displayName,
	localPart: item.localPart,
	domain: item.domain,
	normalizedEmail: item.normalizedEmail,
	flags: item.flags ?? {},
	inboundCount: item.inboundCount ?? 0,
	outboundCount: item.outboundCount ?? 0,
	replyCount: item.replyCount ?? 0,
	lastInboundAt: item.lastInboundAt ?? 0,
	lastReplyAt: item.lastReplyAt ?? 0,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

const FLAG_KEYS = [
	"trusted",
	"blocked",
	"muted",
	"vip",
	"category",
	"autoArchive",
	"unsubscribed",
] as const;

type FlagKey = (typeof FLAG_KEYS)[number];

/**
 * Translate the wire-format `UpdateAddressFlagsInput` into a service-level
 * `FlagsMergePatch`. Only known flag keys are forwarded; unknown keys are
 * silently dropped (a TypeSpec-only schema means unknown keys are a client
 * bug, not a security risk). `null` becomes the explicit "remove" signal.
 */
export const buildFlagsPatch = (
	input: UpdateAddressInput["flags"] | undefined,
): FlagsMergePatch => {
	if (!input) return {};
	const patch = {} as Record<FlagKey, unknown>;
	for (const key of FLAG_KEYS) {
		if (!(key in input)) continue;
		const value = (input as Record<FlagKey, unknown>)[key];
		if (value === null) {
			patch[key] = null;
			continue;
		}
		if (value === undefined) continue;
		patch[key] = value;
	}
	return patch as FlagsMergePatch;
};

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

export const AddressDetailOperations: Record<
	AddressDetailOperationIds,
	OperationHandler<AddressDetailOperationIds>
> = {
	AddressDetailOperations_updateAddress: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { addressId } = context.request.params as { addressId: string };
		const body = (context.request.requestBody ?? {}) as UpdateAddressInput;

		const client = getClient();

		// Authorize: address must belong to the caller's accountConfig
		const existing = await client.address.getAddress(
			accountConfigId,
			addressId,
		);
		if (existing.accountConfigId !== accountConfigId) {
			throw new ForbiddenError(`Address ${addressId} not in account config`);
		}

		const patch = buildFlagsPatch(body.flags);
		if (Object.keys(patch).length === 0) {
			return toAddressResponse(existing);
		}

		const updated = await client.address.mergeFlags(
			accountConfigId,
			addressId,
			patch,
		);
		return toAddressResponse(updated);
	},
};
