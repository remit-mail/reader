import type {
	ClauseField,
	FilterRule,
	MatchOperator,
	PreviewCount,
	RuleClause,
	RuleMatchMode,
	RuleScope,
} from "@remit/ui";
import { pickedDateToExpiresAt } from "./filter-status";
import type { OrganizeDraft } from "./organize-model";
import { derivePropertyClauses } from "./property-prefill";
import type { OrganizeMatchPredicate } from "./sender-fallback";

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
	 * opens on the property-derived literal clauses instead of an anchor.
	 */
	semanticUnavailable: boolean;
	/**
	 * How the rule opens. Defaults to `properties` when the deployment cannot
	 * serve the widen, `similar` otherwise — semantic stays the default wherever
	 * it can run.
	 */
	matchMode?: RuleMatchMode;
	/** Distinct sender addresses of the selection, for the derived clauses. */
	senders: readonly string[];
	/** Subjects of the selected messages, for the shared-subject prefill. */
	subjects?: readonly string[];
	/** How many messages the selection holds — the widen's anchor count. */
	selectionCount: number;
	/** A folder a "Something else" shortcut pre-picked. */
	seedMailboxId?: string;
	/** A scope a "Something else" shortcut pre-picked. */
	seedScope?: RuleScope;
}

export const defaultMatchMode = (
	semanticUnavailable: boolean,
): RuleMatchMode => (semanticUnavailable ? "properties" : "similar");

/** The property prefill as editor chips, flagged as derived so a mode switch
 *  can take back its own guesses without touching a clause the user wrote. */
const derivedClauses = (
	senders: readonly string[],
	subjects: readonly string[],
): RuleClause[] =>
	derivePropertyClauses(senders, subjects).map((clause, index) => ({
		id: `derived-${index}`,
		field: clause.field,
		value: clause.value,
		derived: true,
	}));

export interface RuleMatchers {
	clauses: RuleClause[];
	matchOperator: MatchOperator;
	widen?: FilterRule["widen"];
}

export interface MatchersInput {
	anchorMessageId?: string;
	senders: readonly string[];
	subjects: readonly string[];
	selectionCount: number;
	/** Clauses the user wrote, carried across a mode switch untouched. */
	keepClauses?: RuleClause[];
	/** The operator to keep when the user already has clauses of their own. */
	currentOperator?: MatchOperator;
}

/**
 * What a rule matches on in a given mode, with the action and scope left alone.
 *
 * - `similar` — the semantic widen chip, the anchor doing the work.
 * - `properties` — no anchor at all: the selection's own sender or shared
 *   subject as ordinary literal chips ({@link derivePropertyClauses}).
 *
 * Both keep clauses the user added by hand, so switching mode is never
 * destructive of their own edits.
 */
export const matchersForMode = (
	mode: RuleMatchMode,
	input: MatchersInput,
): RuleMatchers => {
	const kept = input.keepClauses ?? [];
	if (mode === "properties") {
		const prefill = derivedClauses(input.senders, input.subjects).filter(
			(clause) =>
				!kept.some(
					(existing) =>
						existing.field === clause.field && existing.value === clause.value,
				),
		);
		return {
			clauses: [...kept, ...prefill],
			matchOperator: kept.length > 0 ? (input.currentOperator ?? "any") : "any",
			widen: undefined,
		};
	}
	return {
		clauses: kept,
		matchOperator: kept.length > 0 ? (input.currentOperator ?? "all") : "all",
		widen: input.anchorMessageId
			? { anchorCount: Math.max(input.selectionCount, 1) }
			: undefined,
	};
};

/**
 * The rule the editor opens on, built from the widen probe. A semantic-capable
 * deployment opens on the widen chip (the anchor, no literal clauses); one
 * without the vector pipeline, or a user who picked properties matching, opens
 * on the derived `From` / `FromDomain` / `Subject` chips (#251), visible and
 * editable, matched with `Or`. Either way the move destination and scope come
 * from any "Something else" seed.
 */
export const buildInitialRule = (input: InitialRuleInput): FilterRule => {
	const scope = input.seedScope ?? "once";
	const mode = input.matchMode ?? defaultMatchMode(input.semanticUnavailable);
	return {
		...matchersForMode(mode, {
			anchorMessageId: input.anchorMessageId,
			senders: input.senders,
			subjects: input.subjects ?? [],
			selectionCount: input.selectionCount,
		}),
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
 * Whether the matcher behind `/organize/preview` can evaluate this predicate at
 * all. Without an anchor it takes the vector-free literal arm, which reads no
 * message body and rejects a `HasWords` clause rather than narrowing the match
 * silently (`assertNoBodyContentClause`, backend/service/organize.ts). Asking it
 * anyway is a 500, so the caller must not ask.
 */
export const isEvaluablePredicate = (
	predicate: OrganizeMatchPredicate,
): boolean =>
	predicate.anchorMessageId !== undefined ||
	!predicate.literalClauses.some((clause) => clause.field === "HasWords");

/** What the count says when the predicate cannot be counted at all. */
export const UNCOUNTABLE_PREDICATE_REASON =
	"Can't count matches — “has the words” reads message bodies, which only a saved rule does.";

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
