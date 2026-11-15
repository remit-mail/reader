import type {
	MessageSpamVerdict,
	SpamLabelPlacementValue,
	SpamPipeline,
	SpamSettingsItem,
	SpamThresholds,
} from "@remit/data-ports";
import {
	SpamAction,
	SpamJudgeName,
	SpamKind,
	SpamLabelPlacement,
	SpamSenderScreenRule,
} from "@remit/domain-enums";
import { byThresholds } from "./judge.js";

type Kind = (typeof SpamKind)[keyof typeof SpamKind];

/**
 * What placement does with a spam verdict (RFC 041). `Junk` moves the message
 * to Junk, `Warn` leaves it where it arrived; both label it after `kind`.
 */
export type SpamPlacement =
	| { action: "None" }
	| { action: "Warn" | "Junk"; label: Kind };

type Checked = Extract<MessageSpamVerdict, { state: "Checked" }>;

type Decider =
	| { by: "Unknown" }
	| { by: "Rspamd" }
	| { by: "Score"; thresholds: SpamThresholds };

const deciderOf = (verdict: Checked, pipeline: SpamPipeline): Decider => {
	const judge = pipeline.find((config) => config.name === verdict.decidedBy);
	if (!judge) return { by: "Unknown" };
	if (judge.name === SpamJudgeName.Rspamd) return { by: "Rspamd" };
	return { by: "Score", thresholds: judge.thresholds };
};

/**
 * A checked verdict scored below the clean threshold the deciding judge sets.
 * While that judge's thresholds are unset nothing is clean.
 */
export const isConfidentlyClean = (
	verdict: MessageSpamVerdict,
	pipeline: SpamPipeline,
): boolean => {
	if (verdict.state !== "Checked") return false;
	const decider = deciderOf(verdict, pipeline);
	if (decider.by !== "Score") return false;
	const { action, decided } = byThresholds(verdict.score, decider.thresholds);
	return decided && action === SpamAction.None;
};

/**
 * Whether the category classifier's junk answer may move a message on its
 * own. It may not when screening let the message through, or when a
 * calibrated judge decided: the inline judge already weighs the classifier's
 * answer, and its verdict stands.
 */
export const classifierMayJunk = (
	verdict: MessageSpamVerdict,
	pipeline: SpamPipeline,
): boolean => {
	if (verdict.state === "ScreenedOut") return false;
	if (verdict.state !== "Checked") return true;
	const decider = deciderOf(verdict, pipeline);
	if (decider.by === "Unknown") return true;
	if (decider.by === "Rspamd") return false;
	return decider.thresholds.state === "Unset";
};

const NONE: SpamPlacement = { action: "None" };

const placementFor = (
	settings: Pick<SpamSettingsItem, "spamPlacement" | "phishingPlacement">,
	kind: Kind,
): SpamLabelPlacementValue =>
	kind === SpamKind.Phishing
		? settings.phishingPlacement
		: settings.spamPlacement;

/**
 * A sender the owner reported goes to Junk without a check. A checked `Junk`
 * verdict moves unless the owner set its kind to warn only. Thresholds live in
 * the spam service, so while they are unset every action is `None`.
 */
export const spamPlacementOf = (
	verdict: MessageSpamVerdict | undefined,
	settings: Pick<SpamSettingsItem, "spamPlacement" | "phishingPlacement">,
): SpamPlacement => {
	if (verdict?.state === "ScreenedOut") {
		return verdict.screen.rule === SpamSenderScreenRule.ReportedSender
			? { action: "Junk", label: SpamKind.Spam }
			: NONE;
	}
	if (verdict?.state !== "Checked") return NONE;
	if (verdict.action === SpamAction.None) return NONE;
	if (
		verdict.action === SpamAction.Junk &&
		placementFor(settings, verdict.kind) === SpamLabelPlacement.MoveToSpam
	) {
		return { action: "Junk", label: verdict.kind };
	}
	return { action: "Warn", label: verdict.kind };
};
