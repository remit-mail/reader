import type {
	MessageSpamVerdict,
	SpamLabelPlacementValue,
	SpamSettingsItem,
} from "@remit/data-ports";
import {
	SpamAction,
	SpamKind,
	SpamLabelPlacement,
	SpamSenderScreenRule,
} from "@remit/domain-enums";

type Kind = (typeof SpamKind)[keyof typeof SpamKind];

/**
 * What placement does with a spam verdict (RFC 041). `Junk` moves the message
 * to Junk, `Warn` leaves it where it arrived; both label it after `kind`.
 */
export type SpamPlacement =
	| { action: "None" }
	| { action: "Warn" | "Junk"; label: Kind };

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
