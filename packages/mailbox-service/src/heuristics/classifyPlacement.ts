import type { MessageItem } from "@remit/data-ports";
import { SenderTrust } from "@remit/domain-enums";

type SenderTrustValue = (typeof SenderTrust)[keyof typeof SenderTrust];

export type FolderPlacement = "inbox" | "junk" | "other";

export type PlacementAction = "move-to-inbox" | "move-to-junk" | "leave";

export interface PlacementVerdict {
	action: PlacementAction;
	confidence: "confident" | "unsure";
	reasons: string[];
}

const isTrusted = (senderTrust: SenderTrustValue): boolean =>
	senderTrust === SenderTrust.Vip || senderTrust === SenderTrust.Wellknown;

/**
 * Tier 0 deterministic placement verdict (RFC 031, "Confident moves").
 *
 * Pure: the caller resolves the message's current folder placement and the
 * sender trust; this function does no DB lookups and produces no side effects.
 * It generalizes `shouldRescueFromJunk` into a two-directional verdict and is
 * recall-biased — a confident move only fires when cheap, deterministic signals
 * agree; everything else is left in place for a later LLM tier.
 */
export const classifyPlacement = (
	message: MessageItem,
	placement: FolderPlacement,
	senderTrust: SenderTrustValue,
): PlacementVerdict => {
	if (message.movedByRemit === true) {
		return {
			action: "leave",
			confidence: "confident",
			reasons: ["already-moved-by-remit"],
		};
	}

	if (!message.providerSpam || !message.authResult) {
		return {
			action: "leave",
			confidence: "unsure",
			reasons: ["missing-signals"],
		};
	}

	const providerSpam = message.providerSpam.classified === true;
	const dmarc = message.authResult.dmarc;
	const dkimMismatch = message.authenticity?.dkimMismatch === true;
	const trusted = isTrusted(senderTrust);

	// Rescue (junk → inbox), LOW bar. Mirrors shouldRescueFromJunk's gate.
	if (placement === "junk" && providerSpam && dmarc === "Pass") {
		if (trusted) {
			return {
				action: "move-to-inbox",
				confidence: "confident",
				reasons: ["provider=spam", "dmarc=pass", `sender=${senderTrust}`],
			};
		}
		// Anti-spoof guard: an unknown sender is never auto-rescued.
		return {
			action: "leave",
			confidence: "unsure",
			reasons: ["provider=spam", "dmarc=pass", "sender=untrusted"],
		};
	}

	// Demote (inbox → junk), HIGH bar.
	if (placement === "inbox" && dkimMismatch) {
		if (dmarc === "Fail" && !trusted) {
			return {
				action: "move-to-junk",
				confidence: "confident",
				reasons: ["dkim-mismatch", "dmarc=fail", "sender=untrusted"],
			};
		}
		// DMARC-pass phishing: dkimMismatch but DMARC did not fail. Deferred to a
		// later LLM tier — must never auto-demote here.
		if (dmarc === "Pass") {
			return {
				action: "leave",
				confidence: "unsure",
				reasons: ["dkim-mismatch", "dmarc=pass", "deferred-to-llm"],
			};
		}
	}

	return {
		action: "leave",
		confidence: "unsure",
		reasons: ["no-confident-signal"],
	};
};
