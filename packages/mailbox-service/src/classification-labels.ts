import type { ILabelRepository, LabelItem } from "@remit/data-ports";

export const CLASSIFICATION_LABEL_NAMES = ["Priority", "Personal"] as const;

export type ClassificationLabelDeps = Pick<
	ILabelRepository,
	"create" | "findByNormalizedName"
>;

const ensureLabel = async (
	label: ClassificationLabelDeps,
	accountConfigId: string,
	name: string,
): Promise<LabelItem> => {
	const existing = await label.findByNormalizedName(
		accountConfigId,
		name.trim().toLowerCase(),
	);
	if (existing) return existing;
	return label.create({ accountConfigId, name });
};

export const ensureClassificationLabels = async (
	label: ClassificationLabelDeps,
	accountConfigId: string,
): Promise<LabelItem[]> => {
	const labels: LabelItem[] = [];
	for (const name of CLASSIFICATION_LABEL_NAMES) {
		labels.push(await ensureLabel(label, accountConfigId, name));
	}
	return labels;
};
