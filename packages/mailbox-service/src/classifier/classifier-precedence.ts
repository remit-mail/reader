import {
	ClassificationLabel,
	MessageCategory,
	SenderOverride,
} from "@remit/domain-enums";
import type {
	FolderPlacement,
	PlacementVerdict,
} from "../heuristics/classifyPlacement.js";
import type {
	ClassificationLabelValue,
	ClassifierConfidenceKind,
	ClassifierScore,
} from "./classifier-adapter.js";

type MessageCategoryValue =
	(typeof MessageCategory)[keyof typeof MessageCategory];

type SenderOverrideValue = (typeof SenderOverride)[keyof typeof SenderOverride];

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
};

const NO_VERDICT: ClassifierVerdict = { kind: "None" };

export const classifierVerdict = (
	answer: ClassifierAnswer,
	userRuleApplies: boolean,
): ClassifierVerdict => {
	if (userRuleApplies) return NO_VERDICT;
	const threshold = CONFIDENCE_THRESHOLD[answer.confidenceKind];
	const confident = answer.scores.filter(
		(score) => score.confidence >= threshold,
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

export const placementWithClassifier = (
	verdict: PlacementVerdict,
	classifierJunk: boolean,
	placement: FolderPlacement,
	senderOverride: SenderOverrideValue,
): PlacementVerdict => {
	if (!classifierJunk || senderOverride !== SenderOverride.None) {
		return verdict;
	}
	if (verdict.reasons.includes("already-moved-by-remit")) return verdict;
	if (placement === "inbox") {
		return {
			action: "move-to-junk",
			confidence: "confident",
			reasons: ["classifier=spam"],
		};
	}
	if (verdict.action === "move-to-inbox") {
		return {
			action: "leave",
			confidence: "confident",
			reasons: ["classifier=spam"],
		};
	}
	return verdict;
};
