import type {
	AddressResponse,
	UpdateAddressInput,
} from "@remit/api-openapi-types";
import type { AddressItem, FlagsMergePatch } from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import { AddressFlagKey } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/data-client.js";
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

type FlagKey = (typeof AddressFlagKey)[keyof typeof AddressFlagKey];

const FLAG_KEYS = Object.values(AddressFlagKey) as readonly FlagKey[];

/**
 * Translate the wire-format `UpdateAddressInput` into a service-level
 * `FlagsMergePatch`. Only known flag keys are forwarded; unknown keys are
 * silently dropped (a TypeSpec-only schema means unknown keys are a client
 * bug, not a security risk).
 *
 * `clearFlags` is the removal form for every flag whatever its value type, and
 * is applied after `flags`, so a key named in both ends up removed. The `null`
 * alternative on a flag key stays honoured for callers that can express it,
 * but it is unreachable over OAS 3.0: TypeSpec emits a nullable `$ref` as
 * `allOf`, and the request validator drops the `nullable` there.
 */
export const buildFlagsPatch = (
	input: UpdateAddressInput | undefined,
): FlagsMergePatch => {
	if (!input) return {};
	const patch = {} as Record<FlagKey, unknown>;
	const flags = input.flags;
	if (flags) {
		for (const key of FLAG_KEYS) {
			if (!(key in flags)) continue;
			const value = (flags as Record<FlagKey, unknown>)[key];
			if (value === null) {
				patch[key] = null;
				continue;
			}
			if (value === undefined) continue;
			patch[key] = value;
		}
	}
	for (const key of input.clearFlags ?? []) {
		if (!FLAG_KEYS.includes(key)) continue;
		patch[key] = null;
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

		const client = await getClient();

		const result = await client.address.listByAccountConfig({
			accountConfigId,
			search: q.toLowerCase(),
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

		const client = await getClient();

		// Authorize: address must belong to the caller's accountConfig
		const existing = await client.address.getAddress(
			accountConfigId,
			addressId,
		);
		if (existing.accountConfigId !== accountConfigId) {
			throw new ForbiddenError(`Address ${addressId} not in account config`);
		}

		const patch = buildFlagsPatch(body);
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
