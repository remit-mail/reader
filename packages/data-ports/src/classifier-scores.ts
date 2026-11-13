import {
	type ClassifierCategoryCountsSchema,
	type ClassifierLabelCountsSchema,
	ClassifierScoreSchema,
	type ClassifierStatsSchema,
} from "@remit/api-zod-schemas";
import { ClassificationLabel, MessageCategory } from "@remit/domain-enums";
import { z } from "zod";
import type { ClassifierScoreItem } from "./types.js";

const StoredClassifierScoresSchema = z.array(ClassifierScoreSchema);

export const readStoredClassifierScores = (
	stored: unknown,
): ClassifierScoreItem[] => StoredClassifierScoresSchema.parse(stored);

export type ClassifierCategoryCounts = z.infer<
	typeof ClassifierCategoryCountsSchema
>;

export type ClassifierLabelCounts = z.infer<typeof ClassifierLabelCountsSchema>;

export type ClassifierStatsItem = z.infer<typeof ClassifierStatsSchema>;

export interface ClassifierFolderCounts {
	examined: number;
	byCategory: ClassifierCategoryCounts;
	byLabel: ClassifierLabelCounts;
	spamReportedNotJunk: number;
}

export const emptyCategoryCounts = (): ClassifierCategoryCounts => ({
	[MessageCategory.uncategorized]: 0,
	[MessageCategory.personal]: 0,
	[MessageCategory.newsletter]: 0,
	[MessageCategory.marketing]: 0,
	[MessageCategory.automated]: 0,
	[MessageCategory.transactional]: 0,
	[MessageCategory.social]: 0,
	[MessageCategory.coldOutreach]: 0,
});

export const emptyLabelCounts = (): ClassifierLabelCounts => ({
	[ClassificationLabel.Spam]: 0,
	[ClassificationLabel.Phishing]: 0,
	[ClassificationLabel.Priority]: 0,
	[ClassificationLabel.Personal]: 0,
	[ClassificationLabel.Newsletter]: 0,
	[ClassificationLabel.Marketing]: 0,
	[ClassificationLabel.Automated]: 0,
	[ClassificationLabel.Transactional]: 0,
	[ClassificationLabel.Social]: 0,
	[ClassificationLabel.ColdOutreach]: 0,
});

export const emptyFolderCounts = (): ClassifierFolderCounts => ({
	examined: 0,
	byCategory: emptyCategoryCounts(),
	byLabel: emptyLabelCounts(),
	spamReportedNotJunk: 0,
});
