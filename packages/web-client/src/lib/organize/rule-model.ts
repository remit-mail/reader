import type {
	ClauseField,
	FilterRule,
	MatchOperator,
	PreviewCount,
	RuleClause,
	RuleScope,
} from "@remit/ui";
import { pickedDateToExpiresAt } from "./filter-status";
import type { OrganizeDraft } from "./organize-model";
import {
	deriveSenderClauses,
	type OrganizeMatchPredicate,
} from "./sender-fallback";

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

export interface InitialRuleInput {
	/** The semantic anchor — the first selected message. */
	anchorMessageId?: string;
	/**
	 * The deployment ships no vector pipeline, so the widen cannot run. The rule
	 * opens on the sender-derived literal clauses instead of an anchor.
	 */
	semanticUnavailable: boolean;
	/** Distinct sender addresses of the selection, for the fallback clauses. */
	senders: readonly string[];
	/** How many messages the selection holds — the widen's anchor count. */
	selectionCount: number;
	/** A folder a "Something else" shortcut pre-picked. */
	seedMailboxId?: string;
	/** A scope a "Something else" shortcut pre-picked. */
	seedScope?: RuleScope;
}

/**
 * The rule the editor opens on, built from the widen probe. A semantic-capable
 * deployment opens on the widen chip (the anchor, no literal clauses); one
 * without the vector pipeline opens on the sender-fallback `From` chips (#251),
 * visible and editable, matched with `Or`. Either way the move destination and
 * scope come from any "Something else" seed.
 */
export const buildInitialRule = (input: InitialRuleInput): FilterRule => {
	const scope = input.seedScope ?? "once";
	if (input.semanticUnavailable) {
		// The same derivation the widen fallback runs (#251, #262): one `From`
		// clause per sender, or a single `FromDomain` clause when they share a
		// registrable domain. Surfaced as ordinary editable chips.
		const clauses: RuleClause[] = deriveSenderClauses(input.senders).map(
			(clause, index) => ({
				id: `derived-${index}`,
				field: clause.field,
				value: clause.value,
				derived: true,
			}),
		);
		return {
			clauses,
			matchOperator: "any",
			moveMailboxId: input.seedMailboxId,
			scope,
			name: "",
		};
	}
	return {
		clauses: [],
		matchOperator: "all",
		widen: input.anchorMessageId
			? { anchorCount: Math.max(input.selectionCount, 1) }
			: undefined,
		moveMailboxId: input.seedMailboxId,
		scope,
		name: "",
	};
};

/**
 * The match-relevant projection of a rule — the anchor (only while the widen is
 * present and active), the operator, and the literal clauses. Preview and apply
 * both derive from this, so the set the editor counts is the set a commit acts
 * on. Fields that do not change the match set (folder, scope, name, date) are
 * deliberately absent.
 */
export const rulePredicate = (
	rule: FilterRule,
	anchorMessageId?: string,
): OrganizeMatchPredicate => {
	const widenActive = rule.widen !== undefined && !rule.widen.inactive;
	const literalClauses = rule.clauses.map((clause) => ({
		field: clause.field,
		value: clause.value,
	}));
	return {
		...(widenActive && anchorMessageId ? { anchorMessageId } : {}),
		matchOperator: toApiOperator(rule.matchOperator),
		literalClauses,
	};
};

/**
 * A stable key for a predicate's match set. Two predicates with the same key
 * match the same messages; a change to the key is what marks the live count
 * stale and schedules the next preview.
 */
export const predicateSignature = (predicate: OrganizeMatchPredicate): string =>
	JSON.stringify({
		anchor: predicate.anchorMessageId ?? null,
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
export const ruleToDraft = (
	rule: FilterRule,
	anchorMessageId?: string,
): OrganizeDraft => {
	const predicate = rulePredicate(rule, anchorMessageId);
	return {
		...(predicate.anchorMessageId
			? { anchorMessageId: predicate.anchorMessageId }
			: {}),
		matchOperator: predicate.matchOperator,
		literalClauses: predicate.literalClauses,
		moveMailboxId: rule.moveMailboxId,
		expiresAt:
			rule.scope === "until"
				? pickedDateToExpiresAt(rule.until ?? "")
				: undefined,
	};
};

export interface PreviewState {
	/** The last count that came back, `undefined` before the first lands. */
	count?: number;
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
