import type { MessageItem } from "@remit/data-ports";
import { SenderOverride, SenderTrust } from "@remit/domain-enums";

type SenderTrustValue = (typeof SenderTrust)[keyof typeof SenderTrust];

type SenderOverrideValue = (typeof SenderOverride)[keyof typeof SenderOverride];

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
const resolveBlockedVsTrust = (
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
 * Resolve the two axes {@link classifyPlacement} takes: the trust signal, and
 * the user's standing instruction about placement.
 *
 * `blocked` and `neverSpam` are two directly contradictory instructions and
 * cannot both stand — `AddressRepository.mergeFlags` drops the loser at write
 * time. Reading a row that carries both anyway (written before that invariant)
 * resolves to `Blocked`, the same direction the `blocked`/`vip` same-second tie
 * already breaks in: the demote is the recoverable mistake.
 */
export const resolveSenderPlacement = (
	trust: SenderTrustSignal,
	blocked: SenderBlockedSignal,
	neverSpam: boolean,
): {
	senderTrust: SenderTrustValue;
	senderOverride: SenderOverrideValue;
} => {
	const { senderTrust, senderBlocked } = resolveBlockedVsTrust(trust, blocked);
	if (senderBlocked)
		return { senderTrust, senderOverride: SenderOverride.Blocked };
	if (neverSpam)
		return { senderTrust, senderOverride: SenderOverride.NeverSpam };
	return { senderTrust, senderOverride: SenderOverride.None };
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
 * `senderOverride` (RFC 039 Decision 3, issue #605) is the user's standing
 * instruction about this sender's placement, and it outranks every
 * DKIM/DMARC/provider signal below — an explicit block or never-spam grant is
 * not a heuristic. Already-tie-broken against `vip`/`wellknown` by
 * {@link resolveSenderPlacement} in the caller; this function itself does not
 * compare `setAt`.
 *
 * `NeverSpam` is checked above the `missing-signals` return and above the
 * `providerSpam.classified` gate on purpose: the senders who need the grant are
 * the ones the provider rated clean and whose domain publishes no DMARC record,
 * so a check inside the rescue branch below would never fire for them. It
 * rescues only from `junk` — a message a standing filter put in a user folder
 * is not a spam question.
 *
 * It refuses outright on a `dmarc === "Fail"` or a DKIM mismatch. The demote
 * branch below is reached only from `inbox`, so a spoof already sitting in Junk
 * would never meet it: without this guard the grant would launder mail out of
 * Junk on exactly the two signals that identify someone impersonating the
 * address the user granted. A domain that publishes no DMARC record never
 * scores `Fail`, so the case the grant exists for is untouched.
 */
export const classifyPlacement = (
	message: MessageItem,
	placement: FolderPlacement,
	senderTrust: SenderTrustValue,
	senderOverride: SenderOverrideValue,
): PlacementVerdict => {
	if (message.movedByRemit === true) {
		return {
			action: "leave",
			confidence: "confident",
			reasons: ["already-moved-by-remit"],
		};
	}

	if (senderOverride === SenderOverride.Blocked && placement !== "junk") {
		return {
			action: "move-to-junk",
			confidence: "confident",
			reasons: ["sender=blocked"],
		};
	}

	if (
		senderOverride === SenderOverride.NeverSpam &&
		placement === "junk" &&
		message.authResult?.dmarc !== "Fail" &&
		message.authenticity?.dkimMismatch !== true
	) {
		return {
			action: "move-to-inbox",
			confidence: "confident",
			reasons: ["sender=never-spam"],
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
