import type {
	RemitImapCreateFilterInput,
	RemitImapFilterClause,
	RemitImapFilterMatchOperator,
	RemitImapFilterScope,
	RemitImapOrganizeInput,
} from "@remit/api-http-client/types.gen.ts";
import type {
	MatchDoor,
	MatchOperator,
	RuleClause,
	RuleScope,
} from "@remit/ui";
import { pickedDateToExpiresAt } from "./filter-status";

/**
 * The four commit scopes the smart-organize sentence offers (RFC 034 recap):
 *
 * - `just-these` — a one-time action on the current selection. Existing
 *   message-action API, nothing persisted.
 * - `all-like-these` — a one-time retroactive back-apply across the matching
 *   corpus (POST /organize job). Nothing standing persisted.
 * - `standing` — "these and new mail like this": a permanent `Filter`.
 * - `temporary` — "until <date>": a `Filter` that expires on its own.
 */
export type OrganizeScope =
	| "just-these"
	| "all-like-these"
	| "standing"
	| "temporary";

/** The `"None"` sentinel the API uses for an absent label / move action. */
export const NO_ACTION = "None";

/**
 * The user's in-progress organize decision, independent of which scope they
 * land on. The anchor and predicate drive the match set; `moveMailboxId` and
 * `labelId` are the two committable actions (issue #26) — independent of each
 * other, since a move is exclusive and a label is additive (RFC 034 Decision
 * 3.1).
 */
export interface OrganizeDraft {
	/** Semantic anchor — "mail like this one". The first selected message. */
	anchorMessageId?: string;
	/** How `literalClauses` combine. Ignored when there are none. */
	matchOperator: RemitImapFilterMatchOperator;
	/** Literal from/subject/has-words clauses (RFC 031). */
	literalClauses: RemitImapFilterClause[];
	/**
	 * Destination the match set is moved into — the exclusive action (RFC 034
	 * Decision 3.1). Absent means "keep where they are": no move action.
	 */
	moveMailboxId?: string;
	/**
	 * Label applied to the match set — the additive action (RFC 034 Decision
	 * 3.1, issue #26). Absent applies no label.
	 */
	labelId?: string;
	/**
	 * ISO 8601 date-time with zone offset. Present only for the `temporary`
	 * scope; a plain picked date (RFC 034 non-goal: no event-based expiry).
	 */
	expiresAt?: string;
}

/**
 * Whether the draft carries a committable action — a move destination and/or
 * a label (issue #26), either satisfies this. A draft with neither has
 * nothing to commit; the caller disables the CTA and says why (ux.md).
 */
export const hasCommittableAction = (draft: OrganizeDraft): boolean =>
	(draft.moveMailboxId !== undefined && draft.moveMailboxId !== NO_ACTION) ||
	(draft.labelId !== undefined && draft.labelId !== NO_ACTION);

/**
 * Whether the draft's predicate can be back-applied over the existing corpus. A
 * `HasWords` clause matches the full message body, which only the live
 * index-time filter and the vector widen evaluate — the vector-free back-apply
 * projection carries no body and rejects it (`bodyContentRejection`,
 * organize.ts). A rule that carries one is still a valid standing filter for
 * incoming mail, so the back-apply is skipped, not run into that guard.
 */
export const canBackApplyDraft = (draft: OrganizeDraft): boolean =>
	!draft.literalClauses.some((clause) => clause.field === "HasWords");

/**
 * Build the read-only preview / back-apply matcher input. The action fields do
 * not affect which messages match — the preview returns exactly the set a job
 * with the same predicate would apply to — so a widen preview can pass this
 * before the user has chosen a folder or a label.
 */
export const buildOrganizeInput = (
	draft: OrganizeDraft,
): RemitImapOrganizeInput => ({
	...(draft.anchorMessageId ? { anchorMessageId: draft.anchorMessageId } : {}),
	matchOperator: draft.matchOperator,
	literalClauses: draft.literalClauses,
	actionLabelId: draft.labelId ?? NO_ACTION,
	actionMailboxId: draft.moveMailboxId ?? NO_ACTION,
});

/**
 * The two independent answers the wizard collects (#477 4.6). Neither is a
 * scope: the door says what the action covers and the scope step says how long
 * it holds, and the four `OrganizeScope` values fall out of the pair.
 */
export interface WizardCommitAnswers {
	/**
	 * The door the match came through. An escalated predicate is not one: it has
	 * no clauses to build a rule from and no anchor to widen, so a scope
	 * reconstructed for it would be a rule matching everything. Typed to the
	 * three doors so that cannot be written rather than merely not written.
	 */
	mode: MatchDoor;
	/** Absent on the verbs that never reach the scope step — those act once. */
	ruleScope?: RuleScope;
}

/**
 * Which of the four commit scopes the wizard's answers add up to. Reconstructed
 * here and nowhere else, so a driver cannot invent a fifth: the ticked list at
 * scope once is `just-these`, a widened door at scope once is `all-like-these`,
 * and the two persisting scopes are `standing` and `temporary`.
 */
export const organizeScopeFor = ({
	mode,
	ruleScope,
}: WizardCommitAnswers): OrganizeScope => {
	if (ruleScope === "standing") return "standing";
	if (ruleScope === "until") return "temporary";
	return mode === "selected" ? "just-these" : "all-like-these";
};

export interface WizardDraftInput extends WizardCommitAnswers {
	/** The semantic anchor, present only while the similar door is the matcher. */
	anchorMessageId?: string;
	clauses: readonly RuleClause[];
	matchOperator: MatchOperator;
	moveMailboxId?: string;
	/** ISO 8601 civil date (`YYYY-MM-DD`) the `until` scope stops on. */
	until?: string;
}

/**
 * The commit draft for a set of wizard answers. This is where the `until`
 * scope's civil date becomes `expiresAt`, a zoned date-time (#477 5.4): the
 * wizard collects the day the rule stops on, and the day only becomes an
 * instant once there is a draft to carry it.
 */
export const buildWizardDraft = ({
	mode,
	ruleScope,
	anchorMessageId,
	clauses,
	matchOperator,
	moveMailboxId,
	until,
}: WizardDraftInput): OrganizeDraft => ({
	...(mode === "similar" && anchorMessageId ? { anchorMessageId } : {}),
	matchOperator: matchOperator === "all" ? "And" : "Or",
	literalClauses: clauses.map((clause) => ({
		field: clause.field,
		value: clause.value,
	})),
	moveMailboxId,
	expiresAt:
		ruleScope === "until" ? pickedDateToExpiresAt(until ?? "") : undefined,
});

/**
 * Build the `createFilter` body for a standing or temporary filter. `ttl` is
 * derived server-side from `expiresAt`; `expiresAt` is sent only for the
 * temporary scope (RFC 034 Decision 1.3).
 */
export const buildCreateFilterInput = (
	draft: OrganizeDraft,
	scope: Extract<OrganizeScope, "standing" | "temporary">,
	name: string,
): RemitImapCreateFilterInput => {
	const filterScope: RemitImapFilterScope =
		scope === "standing" ? "Standing" : "Temporary";
	return {
		name,
		scope: filterScope,
		...(scope === "temporary" && draft.expiresAt
			? { expiresAt: draft.expiresAt }
			: {}),
		matchOperator: draft.matchOperator,
		literalClauses: draft.literalClauses,
		actionLabelId: draft.labelId ?? NO_ACTION,
		actionMailboxId: draft.moveMailboxId ?? NO_ACTION,
		...(draft.anchorMessageId
			? { anchorMessageId: draft.anchorMessageId }
			: {}),
	};
};
