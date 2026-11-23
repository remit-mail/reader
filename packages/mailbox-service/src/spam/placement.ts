import type {
	MessageSpamVerdict,
	SpamLabelPlacementValue,
	SpamPipeline,
	SpamSettingsItem,
	SpamThresholds,
} from "@remit/data-ports";
import {
	AuthResultVerdict,
	PlacementReason,
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

type PlacementReasonValue =
	(typeof PlacementReason)[keyof typeof PlacementReason];

type AuthVerdict = (typeof AuthResultVerdict)[keyof typeof AuthResultVerdict];

type ScreenRule = Extract<
	MessageSpamVerdict,
	{ state: "ScreenedOut" }
>["screen"]["rule"];

const SCREEN_REASON: Partial<Record<ScreenRule, PlacementReasonValue>> = {
	[SpamSenderScreenRule.NeverSpam]: PlacementReason.SenderNeverSpam,
	[SpamSenderScreenRule.Vip]: PlacementReason.SenderVip,
	[SpamSenderScreenRule.WellKnown]: PlacementReason.SenderWellknown,
	[SpamSenderScreenRule.KnownSender]: PlacementReason.SpamClean,
	[SpamSenderScreenRule.Newsletter]: PlacementReason.SpamClean,
};

const isClean = (
	verdict: Extract<MessageSpamVerdict, { state: "Checked" }>,
	pipeline: SpamPipeline,
): boolean => {
	if (verdict.action !== SpamAction.None) return false;
	const decider = deciderOf(verdict, pipeline);
	if (decider.by === "Rspamd") return true;
	if (decider.by === "Unknown") return false;
	const { action, decided } = byThresholds(verdict.score, decider.thresholds);
	return decided && action === SpamAction.None;
};

/**
 * Why Remit's spam check takes a message out of Junk, or `undefined` when it
 * stays (issue #1428). Screening clears a sender the owner trusts or knows,
 * and a newsletter, but not a reported sender or a filter match. A checked
 * verdict clears when rspamd or a judge with set thresholds decided `None`;
 * while thresholds are unset nothing is decided. A From that failed DMARC
 * never leaves.
 */
export const spamClearsJunk = (
	verdict: MessageSpamVerdict,
	pipeline: SpamPipeline,
	dmarc: AuthVerdict | undefined,
): PlacementReasonValue | undefined => {
	if (dmarc === AuthResultVerdict.Fail) return undefined;
	if (verdict.state === "ScreenedOut")
		return SCREEN_REASON[verdict.screen.rule];
	if (verdict.state !== "Checked") return undefined;
	return isClean(verdict, pipeline) ? PlacementReason.SpamClean : undefined;
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
