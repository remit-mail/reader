import type {
	RemitImapFilterResponse,
	RemitImapUpdateFilterInput,
} from "@remit/api-http-client/types.gen.ts";
import type { FilterRule, RuleClause } from "@remit/ui";
import { NO_ACTION } from "./organize-model";

/**
 * The persisted filter as the chip editor's rule (RFC 038 D6). Loads the whole
 * rule the user edits: literal clauses, the match operator, the move action, the
 * scope (and, for a Temporary filter, the date it stops on), and the semantic
 * anchor as a widen chip. The anchor renders inactive when this deployment
 * cannot evaluate it (D4) — the rule then matches by its literal clauses only.
 *
 * The scope maps `Standing` → "standing" and `Temporary` → "until"; a persisted
 * filter is never the one-time "once" scope. `moveMailboxId` drops the `"None"`
 * sentinel to `undefined` so an empty folder select reads as "no move action".
 */
export const filterToRule = (
	filter: RemitImapFilterResponse,
	semanticUnavailable = false,
): FilterRule => {
	const clauses: RuleClause[] = filter.literalClauses.map((clause, index) => ({
		id: `clause-${index}`,
		field: clause.field,
		value: clause.value,
	}));
	return {
		clauses,
		matchOperator: filter.matchOperator === "And" ? "all" : "any",
		widen: filter.hasAnchor
			? { anchorCount: 1, ...(semanticUnavailable ? { inactive: true } : {}) }
			: undefined,
		moveMailboxId:
			filter.actionMailboxId !== NO_ACTION ? filter.actionMailboxId : undefined,
		scope: filter.scope === "Temporary" ? "until" : "standing",
		until:
			filter.scope === "Temporary"
				? expiresAtToPickedDate(filter.expiresAt)
				: undefined,
		name: filter.name,
	};
};

/**
 * The `YYYY-MM-DD` the date input shows for a stored `expiresAt`. The inverse of
 * {@link pickedDateToExpiresAt}: it reads the local calendar day the timestamp
 * falls on, so a date picked, saved, and reopened comes back unchanged. Empty
 * or unparseable input yields an empty string — the picker's "no date" state.
 */
export const expiresAtToPickedDate = (
	expiresAt: string | undefined,
): string => {
	if (!expiresAt) return "";
	const ms = Date.parse(expiresAt);
	if (Number.isNaN(ms)) return "";
	const date = new Date(ms);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const predicateActionKey = (rule: FilterRule): string =>
	JSON.stringify({
		clauses: rule.clauses.map((clause) => [clause.field, clause.value]),
		operator: rule.matchOperator,
		move: rule.moveMailboxId ?? null,
		widen: rule.widen ? (rule.widen.inactive ? "inactive" : "active") : "none",
	});

/**
 * Whether the edited rule changes the predicate or the action versus the one it
 * was loaded from — the clauses, the match operator, the move target, or the
 * widen's presence. A change here is what bumps `ruleChangedAt` and offers the
 * re-back-apply (RFC 034 Decision 3.2); the name is deliberately excluded, so a
 * cosmetic rename is not a rule change.
 */
export const ruleChangesPredicateOrAction = (
	rule: FilterRule,
	original: FilterRule,
): boolean => predicateActionKey(rule) !== predicateActionKey(original);

/**
 * The PATCH body for an edited filter. A cosmetic rename sends `{ name }` only,
 * so the server's `changesPredicateOrAction` guard leaves `ruleChangedAt`
 * untouched (RFC 034 Decision 3.2). A predicate or action change sends the
 * operator, clauses, and move target, which bumps `ruleChangedAt`. Fields the
 * editor never touches — the label action, the immutable scope/expiry — are
 * absent from the patch, so the partial update preserves them.
 */
export const buildUpdateFilterInput = (
	rule: FilterRule,
	original: FilterRule,
): RemitImapUpdateFilterInput => {
	const body: RemitImapUpdateFilterInput = {};
	const name = (rule.name ?? "").trim();
	if (name !== (original.name ?? "").trim()) body.name = name;
	if (ruleChangesPredicateOrAction(rule, original)) {
		body.matchOperator = rule.matchOperator === "all" ? "And" : "Or";
		body.literalClauses = rule.clauses.map((clause) => ({
			field: clause.field,
			value: clause.value,
		}));
		body.actionMailboxId = rule.moveMailboxId ?? NO_ACTION;
	}
	return body;
};
