import type { ILabelRepository, LabelItem } from "@remit/data-ports";

export const CLASSIFICATION_LABEL_NAMES = [
	"Priority",
	"Personal",
	"Spam",
	"Phishing",
] as const;

export type ClassificationLabelName =
	(typeof CLASSIFICATION_LABEL_NAMES)[number];

export type ClassificationLabels = Record<ClassificationLabelName, LabelItem>;

export type ClassificationLabelDeps = Pick<
	ILabelRepository,
	"create" | "findByNormalizedName"
>;

export const ensureLabel = async (
	label: ClassificationLabelDeps,
	accountConfigId: string,
	name: ClassificationLabelName,
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
): Promise<ClassificationLabels> => ({
	Priority: await ensureLabel(label, accountConfigId, "Priority"),
	Personal: await ensureLabel(label, accountConfigId, "Personal"),
	Spam: await ensureLabel(label, accountConfigId, "Spam"),
	Phishing: await ensureLabel(label, accountConfigId, "Phishing"),
});
