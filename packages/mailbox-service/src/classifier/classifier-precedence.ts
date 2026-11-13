import type { ClassifierScoreItem } from "@remit/data-ports";
import { ClassificationLabel, MessageCategory } from "@remit/domain-enums";
import type { ClassificationLabelName } from "../classification-labels.js";
import type {
	ClassificationLabelValue,
	ClassifierConfidenceKind,
	ClassifierScore,
} from "./classifier-adapter.js";

type MessageCategoryValue =
	(typeof MessageCategory)[keyof typeof MessageCategory];

export const CONFIDENCE_THRESHOLD: Record<ClassifierConfidenceKind, number> = {
	Calibrated: 0.7,
	Advisory: 0.8,
};

export type ClassifierVerdict =
	| { kind: "None" }
	| { kind: "Junk" }
	| { kind: "Priority" }
	| { kind: "Category"; category: MessageCategoryValue };

export interface ClassifierAnswer {
	scores: readonly ClassifierScore[];
	confidenceKind: ClassifierConfidenceKind;
}

const JUNK_LABELS: readonly ClassificationLabelValue[] = [
	ClassificationLabel.Spam,
	ClassificationLabel.Phishing,
];

const CATEGORY_OF: Partial<
	Record<ClassificationLabelValue, MessageCategoryValue>
> = {
	[ClassificationLabel.Personal]: MessageCategory.personal,
	[ClassificationLabel.Newsletter]: MessageCategory.newsletter,
	[ClassificationLabel.Marketing]: MessageCategory.marketing,
	[ClassificationLabel.Automated]: MessageCategory.automated,
	[ClassificationLabel.Transactional]: MessageCategory.transactional,
	[ClassificationLabel.Social]: MessageCategory.social,
	[ClassificationLabel.ColdOutreach]: MessageCategory.coldOutreach,
};

const NO_VERDICT: ClassifierVerdict = { kind: "None" };

export const storedClassifierScores = (
	answer: ClassifierAnswer,
): ClassifierScoreItem[] => {
	const threshold = CONFIDENCE_THRESHOLD[answer.confidenceKind];
	return answer.scores.map((score) => ({
		label: score.label,
		confidence: score.confidence,
		confident: score.confidence >= threshold,
	}));
};

export const classifierVerdict = (
	answer: ClassifierAnswer,
): ClassifierVerdict => {
	const confident = storedClassifierScores(answer).filter(
		(score) => score.confident,
	);
	if (confident.some((score) => JUNK_LABELS.includes(score.label))) {
		return { kind: "Junk" };
	}
	if (confident.some((score) => score.label === ClassificationLabel.Priority)) {
		return { kind: "Priority" };
	}
	const top = confident
		.filter((score) => CATEGORY_OF[score.label] !== undefined)
		.reduce<ClassifierScore | undefined>(
			(best, score) =>
				best === undefined || score.confidence > best.confidence ? score : best,
			undefined,
		);
	const category = top ? CATEGORY_OF[top.label] : undefined;
	if (category === undefined) return NO_VERDICT;
	return { kind: "Category", category };
};

export const classificationLabelOf = (
	verdict: ClassifierVerdict,
): ClassificationLabelName | undefined => {
	if (verdict.kind === "Priority") return "Priority";
	if (
		verdict.kind === "Category" &&
		verdict.category === MessageCategory.personal
	) {
		return "Personal";
	}
	return undefined;
};
