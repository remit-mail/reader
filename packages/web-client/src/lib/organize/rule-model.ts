import type {
	ClauseField,
	FilterRule,
	MatchOperator,
	PreviewCount,
} from "@remit/ui";
import { pickedDateToExpiresAt } from "./filter-status";
import type { OrganizeDraft, OrganizeMatchPredicate } from "./organize-model";

/**
 * The clause fields the Organize editor may offer (RFC 038 D2). Gated on what
 * the backend matcher evaluates, not on what the generated enum carries: every
 * one of these is honored by the literal matcher and the back-apply corpus
 * projection (match.ts), so a chip never previews a set the apply can't
 * reproduce. `ListId` and `FromDomain` joined once their matcher shipped (#262).
 */
export const SUPPORTED_CLAUSE_FIELDS: ClauseField[] = [
	"From",
	"Subject",
	"HasWords",
	"ListId",
	"FromDomain",
];

/**
 * Canonical form of a `ListId` clause value, matching the backend's
 * `normalizeListId` (list-id.ts): the bracketed identifier when present,
 * otherwise the whole value, trimmed and case-folded. Normalizing at input keeps
 * the chip the user sees identical to the value the matcher compares, so
 * `<weekly.news.example.com>` and `Weekly.News.Example.com` are one list.
 */
export const normalizeListId = (value: string): string => {
	const trimmed = value.trim();
	const bracketed = trimmed.match(/<([^>]+)>/);
	return (bracketed ? bracketed[1] : trimmed).trim().toLowerCase();
};

/** Canonicalize a clause value for its field before it becomes a chip. */
export const normalizeClauseValue = (
	field: ClauseField,
	value: string,
): string => (field === "ListId" ? normalizeListId(value) : value.trim());

const toApiOperator = (operator: MatchOperator): "And" | "Or" =>
	operator === "all" ? "And" : "Or";

/**
 * The match-relevant projection of a rule — the operator and the literal
 * clauses. Preview and apply
 * both derive from this, so the set the editor counts is the set a commit acts
 * on. Fields that do not change the match set (folder, scope, name, date) are
 * deliberately absent.
 */
export const rulePredicate = (rule: FilterRule): OrganizeMatchPredicate => ({
	matchOperator: toApiOperator(rule.matchOperator),
	literalClauses: rule.clauses.map((clause) => ({
		field: clause.field,
		value: clause.value,
	})),
});

/**
 * Whether the matcher behind `/organize/preview` can evaluate this predicate at
 * all. It reads no message body and rejects a `HasWords` clause rather than
 * narrowing the match silently (`bodyContentRejection`, backend/service/organize.ts). Asking it
 * anyway is refused with a 400, on preview and on a back-apply alike, so the
 * caller must not ask.
 */
export const isEvaluablePredicate = (
	predicate: OrganizeMatchPredicate,
): boolean =>
	!predicate.literalClauses.some((clause) => clause.field === "HasWords");

/**
 * A stable key for a predicate's match set. Two predicates with the same key
 * match the same messages; a change to the key is what marks the live count
 * stale and schedules the next preview.
 */
export const predicateSignature = (predicate: OrganizeMatchPredicate): string =>
	JSON.stringify({
		operator: predicate.matchOperator,
		clauses: predicate.literalClauses.map(
			(clause) => `${clause.field} ${clause.value}`,
		),
	});

/**
 * The commit draft for a rule. The match fields are exactly
 * {@link rulePredicate}'s — the previewed predicate — with the folder action
 * and, for the `until` scope, the derived expiry added. The expiry never enters
 * the match set, so preview and apply still count and act on the same messages.
 */
export const ruleToDraft = (rule: FilterRule): OrganizeDraft => {
	const predicate = rulePredicate(rule);
	return {
		matchOperator: predicate.matchOperator,
		literalClauses: predicate.literalClauses,
		moveMailboxId: rule.moveMailboxId,
		labelId: rule.labelId,
		expiresAt:
			rule.scope === "until"
				? pickedDateToExpiresAt(rule.until ?? "")
				: undefined,
	};
};

export interface PreviewState {
	/** The last count that came back, `undefined` before the first lands. */
	count?: number;
	/** The ids that count was counted over, as the server bounded them. */
	matchedIds?: readonly string[];
	/** The signature the {@link count} was counted for. */
	previewedSignature?: string;
	/** The signature the last error was raised for. */
	errorSignature?: string;
	error?: string;
}

/**
 * The live count for the rule on screen. The count is `ready` only when it was
 * counted for the current predicate; a predicate change since then reads
 * `stale` (recounting, never blank) so the commit gate can hold apply until it
 * settles.
 */
export const derivePreview = (
	state: PreviewState,
	currentSignature: string,
): PreviewCount => {
	if (state.error !== undefined && state.errorSignature === currentSignature) {
		return { status: "error", reason: state.error };
	}
	if (state.count === undefined) return { status: "loading" };
	if (state.previewedSignature === currentSignature) {
		return { status: "ready", count: state.count };
	}
	return { status: "ready", count: state.count, stale: true };
};

/** How long a rule change settles before the next preview fires. */
export const PREVIEW_DEBOUNCE_MS = 350;
