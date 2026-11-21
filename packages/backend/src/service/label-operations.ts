import type { LabelResponse, UpdateLabelInput } from "@remit/api-openapi-types";
import type { LabelItem } from "@remit/data-ports";
import {
	type LabelFolder,
	type LabelFolderDeps,
	labelFoldersFor,
	ownedAccount,
} from "@remit/mailbox-service";
import type { RemitClient } from "./data-client.js";
import { findFiltersForLabel } from "./label-delete.js";
import { unwrap } from "./refusal.js";

export const foldersOf = async (
	deps: LabelFolderDeps,
	accountConfigId: string,
	label: LabelItem,
): Promise<LabelFolder[]> =>
	(await labelFoldersFor(deps, accountConfigId, [label])).flatMap(
		({ folders }) => folders,
	);

export const toLabelResponse = (
	item: LabelItem,
	filterCount: number,
	folders: LabelFolder[],
): LabelResponse => ({
	labelId: item.labelId,
	accountConfigId: item.accountConfigId,
	name: item.name,
	color: item.color,
	filterCount,
	folders,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

const labelResponseFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	label: LabelItem,
): Promise<LabelResponse> => {
	const [filters, folders] = await Promise.all([
		findFiltersForLabel(client, accountConfigId, label.labelId),
		labelFoldersFor(client, accountConfigId, [label]),
	]);
	return toLabelResponse(
		label,
		filters.length,
		folders.flatMap((entry) => entry.folders),
	);
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
