import {
	FILTER_NO_ACTION,
	type FilterItem,
	filterRuleFromClauses,
} from "@remit/data-ports";
import { FilterMatchOperator } from "@remit/domain-enums";
import {
	evaluateRule,
	type FilterMessage,
	type GetDomain,
	orderFilters,
	type RuleNarrowing,
	ruleNarrowing,
} from "./rule.js";

export type { FilterMessage, GetDomain } from "./rule.js";

type FilterClause = FilterItem["literalClauses"][number];

export const NO_ACTION = FILTER_NO_ACTION;

export type LiteralClauseNarrowing = RuleNarrowing;

export const literalClausesMatch = (
	clauses: readonly FilterClause[],
	operator: FilterItem["matchOperator"],
	msg: FilterMessage,
	getDomain: GetDomain,
): boolean =>
	evaluateRule(
		filterRuleFromClauses({
			matchOperator: operator,
			literalClauses: [...clauses],
		}),
		msg,
		getDomain,
	);

export const clauseMatches = (
	clause: FilterClause,
	msg: FilterMessage,
	getDomain: GetDomain,
): boolean =>
	literalClausesMatch([clause], FilterMatchOperator.And, msg, getDomain);

export const literalClauseTerms = (
	clauses: readonly FilterClause[],
	operator: FilterItem["matchOperator"],
	getDomain: GetDomain,
): LiteralClauseNarrowing | null =>
	ruleNarrowing(
		filterRuleFromClauses({
			matchOperator: operator,
			literalClauses: [...clauses],
		}),
		getDomain,
	);

export const selectMoveWinner = (
	candidates: readonly FilterItem[],
): FilterItem | undefined => orderFilters(candidates)[0];
