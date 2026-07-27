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

/** The trust signal plus the `setAt` of whichever flag (`vip`/`wellknown`) produced it, `undefined` when the sender is `Unknown`. */
export interface SenderTrustSignal {
	trust: SenderTrustValue;
	setAt?: number;
}

/** The sender's `blocked` flag value plus its `setAt`. */
export interface SenderBlockedSignal {
	blocked: boolean;
	setAt?: number;
}

/**
 * RFC 039 Decision 3a: when a sender's `blocked` flag and their `vip`/
 * `wellknown` flag disagree on placement, the one set most recently wins.
 * Scoped to {@link classifyPlacement}'s own verdict only — it never touches
 * `deriveSenderTrust` or the trust badge, which stay a plain `vip → wellknown
 * → unknown` read with no `blocked` case.
 *
 * A same-second tie (both `setAt` floor to the same second) breaks in a
 * fixed, arbitrary order: `blocked` before `vip` before `wellknown` — a
 * determinism backstop, not a meaningful signal.
 */
export const resolveBlockedVsTrust = (
	trust: SenderTrustSignal,
	blocked: SenderBlockedSignal,
): { senderTrust: SenderTrustValue; senderBlocked: boolean } => {
	if (!blocked.blocked) {
		return { senderTrust: trust.trust, senderBlocked: false };
	}
	if (trust.trust === SenderTrust.Unknown || trust.setAt === undefined) {
		return { senderTrust: SenderTrust.Unknown, senderBlocked: true };
	}

	const blockedSecond = Math.floor((blocked.setAt ?? 0) / 1000);
	const trustSecond = Math.floor(trust.setAt / 1000);

	// Newer (or a same-second tie, which `blocked` wins) — blocked wins.
	if (blockedSecond >= trustSecond) {
		return { senderTrust: SenderTrust.Unknown, senderBlocked: true };
	}
	return { senderTrust: trust.trust, senderBlocked: false };
};

/**
 * Tier 0 deterministic placement verdict (RFC 031, "Confident moves").
 *
 * Pure: the caller resolves the message's current folder placement and the
 * sender trust; this function does no DB lookups and produces no side effects.
 * It generalizes `shouldRescueFromJunk` into a two-directional verdict and is
 * recall-biased — a confident move only fires when cheap, deterministic signals
 * agree; everything else is left in place for a later LLM tier.
 *
 * `senderBlocked` (RFC 039 Decision 3) is a confident demote independent of
 * every DKIM/DMARC/provider signal below — a user's explicit block is not a
 * heuristic. Already-tie-broken against `vip`/`wellknown` by
 * {@link resolveBlockedVsTrust} in the caller; this function itself does not
 * compare `setAt`.
 */
export const classifyPlacement = (
	message: MessageItem,
	placement: FolderPlacement,
	senderTrust: SenderTrustValue,
	senderBlocked: boolean,
): PlacementVerdict => {
	if (message.movedByRemit === true) {
		return {
			action: "leave",
			confidence: "confident",
			reasons: ["already-moved-by-remit"],
		};
	}

	if (senderBlocked && placement !== "junk") {
		return {
			action: "move-to-junk",
			confidence: "confident",
			reasons: ["sender=blocked"],
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
