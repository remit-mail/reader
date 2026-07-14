import type {
	RemitImapCreateFilterInput,
	RemitImapFilterClause,
	RemitImapFilterMatchOperator,
	RemitImapFilterScope,
	RemitImapOrganizeInput,
} from "@remit/api-http-client/types.gen.ts";

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
 * land on. The anchor and predicate drive the match set; `moveMailboxId` is the
 * one committable action today (labeling has no backend yet — see
 * `labelPlaceholder`).
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
	 * ISO 8601 date-time with zone offset. Present only for the `temporary`
	 * scope; a plain picked date (RFC 034 non-goal: no event-based expiry).
	 */
	expiresAt?: string;
}

/**
 * Whether the draft carries a committable action. Labeling is not wired yet
 * (no Label API — RFC 030's `Label`/`MessageLabel` entities exist in TypeSpec
 * but have no CRUD endpoint), so a move target is the only real action. A draft
 * with no move target has nothing to commit; the caller disables the CTA and
 * says why (ux.md).
 */
export const hasCommittableAction = (draft: OrganizeDraft): boolean =>
	draft.moveMailboxId !== undefined && draft.moveMailboxId !== NO_ACTION;

/**
 * Build the read-only preview / back-apply matcher input. The action fields do
 * not affect which messages match — the preview returns exactly the set a job
 * with the same predicate would apply to — so a widen preview can pass this
 * before the user has chosen a folder.
 */
export const buildOrganizeInput = (
	draft: OrganizeDraft,
): RemitImapOrganizeInput => ({
	...(draft.anchorMessageId ? { anchorMessageId: draft.anchorMessageId } : {}),
	matchOperator: draft.matchOperator,
	literalClauses: draft.literalClauses,
	actionLabelId: NO_ACTION,
	actionMailboxId: draft.moveMailboxId ?? NO_ACTION,
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
		actionLabelId: NO_ACTION,
		actionMailboxId: draft.moveMailboxId ?? NO_ACTION,
		...(draft.anchorMessageId
			? { anchorMessageId: draft.anchorMessageId }
			: {}),
	};
};
