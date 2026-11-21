import type { LabelResponse, UpdateLabelInput } from "@remit/api-openapi-types";
import type { LabelItem } from "@remit/data-ports";
import { labelFoldersFor, ownedAccount } from "@remit/mailbox-service";
import type { RemitClient } from "./data-client.js";
import { findFiltersForLabel } from "./label-delete.js";
import { unwrap } from "./refusal.js";

const labelResponseFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	label: LabelItem,
): Promise<LabelResponse> => {
	const [filters, folders] = await Promise.all([
		findFiltersForLabel(client, accountConfigId, label.labelId),
		labelFoldersFor(client, accountConfigId, [label]),
	]);
	return {
		labelId: label.labelId,
		accountConfigId: label.accountConfigId,
		name: label.name,
		color: label.color,
		filterCount: filters.length,
		folders: folders.flatMap((entry) => entry.folders),
		createdAt: label.createdAt,
		updatedAt: label.updatedAt,
	};
};

export const updateLabelFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	accountId: string,
	labelId: string,
	input: UpdateLabelInput,
): Promise<LabelResponse> => {
	unwrap(
		ownedAccount(await client.account.get(accountId), accountConfigId, "act"),
	);
	return labelResponseFor(
		client,
		accountConfigId,
		await client.label.update(accountConfigId, labelId, input),
	);
};
