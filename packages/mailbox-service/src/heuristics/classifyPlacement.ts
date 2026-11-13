import type { MessageItem, UpdateMessageInput } from "@remit/data-ports";
import {
	PlacementAction as PlacementActionValue,
	PlacementConfidence,
	SenderOverride,
	SenderTrust,
} from "@remit/domain-enums";

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
 * The provider's spam verdict is not an input (issue #1553): only
 * authentication, the sender's flags and trust, and `junk` decide. `junk` is
 * the category classifier's junk answer or the spam service's `Junk` action
 * (RFC 041).
 *
 * `senderOverride` (RFC 039 Decision 3, issue #605) is the user's standing
 * instruction about this sender's placement, and it outranks every DKIM/DMARC
 * signal below — an explicit block or never-spam grant is not a heuristic.
 * Already-tie-broken against `vip`/`wellknown` by
 * {@link resolveSenderPlacement} in the caller; this function itself does not
 * compare `setAt`.
 *
 * A junk answer yields to Vip and Wellknown (issue #1553): the user set the
 * one and replied to the other.
 */
export const classifyPlacement = (
	message: MessageItem,
	placement: FolderPlacement,
	senderTrust: SenderTrustValue,
	senderOverride: SenderOverrideValue,
	junk: boolean,
): PlacementVerdict => {
	if (senderOverride === SenderOverride.Blocked) {
		return {
			action: "move-to-junk",
			confidence: "confident",
			reasons: ["sender=blocked"],
		};
	}

	const dmarc = message.authResult?.dmarc;
	const dkimMismatch = message.authenticity?.dkimMismatch === true;

	const trusted = isTrusted(senderTrust);

	if (junk && senderOverride === SenderOverride.None && !trusted) {
		return placement === "inbox"
			? {
					action: "move-to-junk",
					confidence: "confident",
					reasons: ["classifier=spam"],
				}
			: {
					action: "leave",
					confidence: "confident",
					reasons: ["classifier=spam"],
				};
	}

	// Demote (inbox → junk), HIGH bar.
	if (placement === "inbox" && dkimMismatch && dmarc === "Fail" && !trusted) {
		return {
			action: "move-to-junk",
			confidence: "confident",
			reasons: ["dkim-mismatch", "dmarc=fail", "sender=untrusted"],
		};
	}

	return {
		action: "leave",
		confidence: "unsure",
		reasons: ["no-confident-signal"],
	};
};

export type PlacementDestination = "inbox" | "archive" | "junk";

/**
 * What body sync does with a message's placement. `verdict.action` is relative
 * to the folder the message sits in; `destination` is where it moves, and an
 * actionable verdict with no destination is recorded only.
 */
export interface PlacementDecision {
	verdict: PlacementVerdict;
	destination: PlacementDestination | undefined;
}

/**
 * Decide a message's placement (issue #1553). Pure.
 *
 * A message Remit already moved is never re-decided, whatever the user did
 * with it since.
 *
 * A message in Junk is judged as if it had arrived in the Inbox: the
 * provider's spam folder is not a signal. One that verdict would demote stays
 * in Junk, recorded as `move-to-junk`. Every other one leaves Junk whatever
 * the confidence, since `unsure` is not junk. A Junk message somebody already
 * placed is never touched (issue #383): a spam report and a user move
 * (`originalMailboxId`) each mean the folder is a decision, not the
 * provider's arrival.
 *
 * Outside Junk only a confident actionable verdict moves; an unsure one is
 * recorded.
 *
 * `autoArchive` (issue #300) files mail that would otherwise stay put or go to
 * the Inbox in the Archive; it never overrides a junk verdict.
 */
export const decidePlacement = (
	message: MessageItem,
	placement: FolderPlacement,
	senderTrust: SenderTrustValue,
	senderOverride: SenderOverrideValue,
	junk: boolean,
	autoArchive: boolean,
): PlacementDecision => {
	if (message.movedByRemit === true) {
		return {
			verdict: {
				action: "leave",
				confidence: "confident",
				reasons: ["already-moved-by-remit"],
			},
			destination: undefined,
		};
	}

	if (placement !== "junk") {
		const verdict = classifyPlacement(
			message,
			placement,
			senderTrust,
			senderOverride,
			junk,
		);
		if (verdict.action === "leave") {
			return { verdict, destination: autoArchive ? "archive" : undefined };
		}
		return {
			verdict,
			destination: verdict.confidence === "confident" ? "junk" : undefined,
		};
	}

	if (message.spamReport || message.originalMailboxId) {
		return {
			verdict: {
				action: "leave",
				confidence: "confident",
				reasons: ["placed-in-junk"],
			},
			destination: undefined,
		};
	}

	const asInbox = classifyPlacement(
		message,
		"inbox",
		senderTrust,
		senderOverride,
		junk,
	);
	if (asInbox.action === "move-to-junk") {
		return { verdict: asInbox, destination: undefined };
	}
	return {
		verdict: {
			action: "move-to-inbox",
			confidence: asInbox.confidence,
			reasons: asInbox.reasons,
		},
		destination: autoArchive ? "archive" : "inbox",
	};
};

export type MessagePlacementVerdict = NonNullable<
	UpdateMessageInput["placementVerdict"]
>;

export const placementVerdictRecord = (
	{ verdict, destination }: PlacementDecision,
	placement: FolderPlacement,
	decidedAt: number,
): MessagePlacementVerdict | undefined => {
	if (verdict.action === "leave" || destination === "archive") return undefined;
	return {
		action:
			verdict.action === "move-to-inbox"
				? PlacementActionValue.MoveToInbox
				: PlacementActionValue.MoveToJunk,
		confidence:
			verdict.confidence === "confident"
				? PlacementConfidence.Confident
				: PlacementConfidence.Unsure,
		fromPlacement: placement,
		reasons: verdict.reasons,
		dryRun: false,
		decidedAt,
	};
};
