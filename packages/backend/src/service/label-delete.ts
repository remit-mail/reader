import type {
	FilterItem,
	IFilterRepository,
	ILabelRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";

export interface LabelDeleteDeps {
	label: Pick<ILabelRepository, "delete">;
	filter: Pick<IFilterRepository, "listByAccountConfig" | "delete">;
	messageLabel: Pick<IMessageLabelRepository, "removeAllByLabelId">;
}

/**
 * Every filter in the account whose action applies this label (issue #26). The
 * count backs `LabelResponse.filterCount`; the list backs the cascade delete.
 */
export const findFiltersForLabel = async (
	deps: Pick<LabelDeleteDeps, "filter">,
	accountConfigId: string,
	labelId: string,
): Promise<FilterItem[]> => {
	const filters = await deps.filter.listByAccountConfig(accountConfigId);
	return filters.filter((filter) => filter.actionLabelId === labelId);
};

/**
 * Delete a label and cascade in both directions (issue #26): every filter
 * whose `actionLabelId` is this label is deleted outright — never left
 * dangling, never blocking the delete — and every `MessageLabel` row for it is
 * removed. The label row itself is deleted last so a failure mid-cascade never
 * leaves the label gone while its filters or applied-to-messages still exist.
 * Returns the filters it deleted.
 */
export const deleteLabelWithCascade = async (
	deps: LabelDeleteDeps,
	accountConfigId: string,
	labelId: string,
): Promise<FilterItem[]> => {
	const filters = await findFiltersForLabel(deps, accountConfigId, labelId);
	for (const filter of filters) {
		await deps.filter.delete(accountConfigId, filter.filterId);
	}
	await deps.messageLabel.removeAllByLabelId(accountConfigId, labelId);
	await deps.label.delete(accountConfigId, labelId);
	return filters;
};
