import type { MessageSpamVerdict } from "@remit/data-ports";
import {
	AuthResultVerdict,
	SenderOverride,
	SenderTrust,
	SpamSenderScreenRule,
} from "@remit/domain-enums";
import type { FilterDecision } from "../filters/pipeline.js";
import type { SenderPlacement } from "../sender-placement.js";

type ScreenedOut = Extract<MessageSpamVerdict, { state: "ScreenedOut" }>;
type Screen = ScreenedOut["screen"];
type AuthVerdict = (typeof AuthResultVerdict)[keyof typeof AuthResultVerdict];

export interface ScreenInput {
	sender: Pick<SenderPlacement, "senderTrust" | "senderOverride">;
	filterDecision: FilterDecision;
	hasListUnsubscribe: boolean;
	dmarc: AuthVerdict | undefined;
	senderMessagesSeen: number;
}

type SenderRule =
	(typeof SpamSenderScreenRule)[keyof typeof SpamSenderScreenRule];

const bySender = (rule: SenderRule): Screen => ({ rule });

/**
 * Stage 1 (RFC 041): the rule that lets a message through without a call to
 * the spam service, or `undefined` when the message goes to the service. A
 * newsletter passes only from a sender with earlier mail and with DMARC
 * passing, since a phisher can add List-Unsubscribe too. A Never in Spam
 * sender is screened out only when DMARC did not fail, so a forged From of
 * that sender still reaches the judge.
 */
export const screen = (input: ScreenInput): Screen | undefined => {
	const { sender, filterDecision } = input;
	if (sender.senderOverride === SenderOverride.Blocked) {
		return bySender(SpamSenderScreenRule.ReportedSender);
	}
	if (
		sender.senderOverride === SenderOverride.NeverSpam &&
		input.dmarc !== AuthResultVerdict.Fail
	) {
		return bySender(SpamSenderScreenRule.NeverSpam);
	}
	if (sender.senderTrust === SenderTrust.Vip) {
		return bySender(SpamSenderScreenRule.Vip);
	}
	if (sender.senderTrust === SenderTrust.Wellknown) {
		return bySender(SpamSenderScreenRule.WellKnown);
	}
	const filterId =
		filterDecision.move?.filterId ?? filterDecision.labels[0]?.filterId;
	if (filterId !== undefined) return { rule: "Filter", filterId };
	if (
		input.hasListUnsubscribe &&
		input.dmarc === AuthResultVerdict.Pass &&
		input.senderMessagesSeen > 0
	) {
		return bySender(SpamSenderScreenRule.Newsletter);
	}
	return undefined;
};
