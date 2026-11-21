import type {
	AddressResponse,
	AddressTrustFlag,
	UpdateAddressInput,
} from "@remit/api-openapi-types";
import type {
	AddressFlags,
	AddressItem,
	FlagsMergePatch,
} from "@remit/data-ports";
import { ForbiddenError } from "@remit/data-ports/errors";
import { AddressFlagKey } from "@remit/domain-enums";
import type { RemitClient } from "./data-client.js";
import { requestNeverSpamBackApply } from "./never-spam.js";

type FlagKey = (typeof AddressFlagKey)[keyof typeof AddressFlagKey];
const FLAG_KEYS = Object.values(AddressFlagKey) as readonly FlagKey[];

const toAddressResponse = (item: AddressItem): AddressResponse => ({
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

const buildFlagsPatch = (input: UpdateAddressInput): FlagsMergePatch => {
	const patch = {} as Record<FlagKey, unknown>;
	if (input.flags) {
		for (const key of FLAG_KEYS) {
			if (!(key in input.flags)) continue;
			const value = (input.flags as Record<FlagKey, unknown>)[key];
			if (value === null) patch[key] = null;
			else if (value !== undefined) patch[key] = value;
		}
	}
	for (const key of input.clearFlags ?? []) {
		if (FLAG_KEYS.includes(key)) patch[key] = null;
	}
	return patch as FlagsMergePatch;
};

const backApplyCategoryFlag = (
	patch: FlagsMergePatch,
): NonNullable<AddressFlags["category"]> | undefined => {
	const flag = patch.category;
	return flag === null ? undefined : flag;
};

export const searchAddressesFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	query: { q: string; limit?: number; flag?: AddressTrustFlag },
) => {
	const result = await client.address.listByAccountConfig({
		accountConfigId,
		search: query.q.toLowerCase(),
		flag: query.flag,
		limit: query.limit ?? 10,
	});
	return {
		items: result.items.map(toAddressResponse),
		continuationToken: result.continuationToken,
	};
};

export const updateAddressFor = async (
	client: RemitClient<"accountFanout">,
	accountConfigId: string,
	addressId: string,
	input: UpdateAddressInput,
): Promise<AddressResponse> => {
	const existing = await client.address.getAddress(accountConfigId, addressId);
	if (existing.accountConfigId !== accountConfigId) {
		throw new ForbiddenError(`Address ${addressId} not in account config`);
	}
	const patch = buildFlagsPatch(input);
	if (Object.keys(patch).length === 0) return toAddressResponse(existing);
	const updated = await client.address.mergeFlags(
		accountConfigId,
		addressId,
		patch,
	);
	const flag = backApplyCategoryFlag(patch);
	if (flag) {
		await client.queues.accountFanout
			.send({
				body: {
					type: "SenderCategoryBackApply",
					accountConfigId,
					addressId,
					normalizedEmail: updated.normalizedEmail,
					category: flag.value,
					categorySetAt: flag.setAt,
				},
			})
			.catch((cause: unknown) => {
				throw new Error(
					`The ${flag.value} override is saved and applies to this sender's next message, but the pass over their existing mail could not be started. Setting the same category again retries it.`,
					{ cause },
				);
			});
	}
	if (
		patch.neverSpam?.value === true &&
		updated.flags?.neverSpam?.value === true
	) {
		await requestNeverSpamBackApply(client.queues.accountFanout, {
			accountConfigId,
			addressId,
			normalizedEmail: updated.normalizedEmail,
		});
	}
	return toAddressResponse(updated);
};
