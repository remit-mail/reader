import { FilterRuleV0Schema, FilterRuleV1Schema } from "@remit/api-zod-schemas";
import {
	FilterClauseField,
	FilterMatchOperator,
	FilterRuleAddressPart,
	FilterRuleHeader,
	FilterRuleMatch,
} from "@remit/domain-enums";
import { z } from "zod";
import type {
	FilterClauseItem,
	FilterClauses,
	FilterRuleV1Item,
	FilterTestItem,
} from "./types.js";

const clauseTest = (clause: FilterClauseItem): FilterTestItem => {
	switch (clause.field) {
		case FilterClauseField.From:
			return {
				test: "header",
				match: FilterRuleMatch.Contains,
				header: FilterRuleHeader.From,
				key: clause.value,
			};
		case FilterClauseField.Subject:
			return {
				test: "header",
				match: FilterRuleMatch.Contains,
				header: FilterRuleHeader.Subject,
				key: clause.value,
			};
		case FilterClauseField.ListId:
			return {
				test: "header",
				match: FilterRuleMatch.Is,
				header: FilterRuleHeader.ListId,
				key: clause.value,
			};
		case FilterClauseField.FromDomain:
			return {
				test: "address",
				match: FilterRuleMatch.Is,
				part: FilterRuleAddressPart.RegistrableDomain,
				key: clause.value,
			};
		case FilterClauseField.HasWords:
			return {
				test: "hasWords",
				words: clause.value.split(/\s+/).filter(Boolean),
			};
	}
};

type FilterHeaderTestItem = Extract<FilterTestItem, { test: "header" }>;

const HEADER_CLAUSE_FIELDS: Record<
	FilterHeaderTestItem["match"],
	Partial<Record<FilterHeaderTestItem["header"], FilterClauseItem["field"]>>
> = {
	[FilterRuleMatch.Contains]: {
		[FilterRuleHeader.From]: FilterClauseField.From,
		[FilterRuleHeader.Subject]: FilterClauseField.Subject,
	},
	[FilterRuleMatch.Is]: {
		[FilterRuleHeader.ListId]: FilterClauseField.ListId,
	},
};

const testClause = (test: FilterTestItem): FilterClauseItem | undefined => {
	switch (test.test) {
		case "header": {
			const field = HEADER_CLAUSE_FIELDS[test.match][test.header];
			return field ? { field, value: test.key } : undefined;
		}
		case "address":
			return test.match === FilterRuleMatch.Is &&
				test.part === FilterRuleAddressPart.RegistrableDomain
				? { field: FilterClauseField.FromDomain, value: test.key }
				: undefined;
		case "hasWords":
			return { field: FilterClauseField.HasWords, value: test.words.join(" ") };
		default:
			return undefined;
	}
};

export { FilterRuleV1Schema };

export const filterRuleFromClauses = ({
	matchOperator,
	literalClauses,
}: FilterClauses): FilterRuleV1Item => {
	const tests = literalClauses.map(clauseTest);
	return {
		version: 1,
		test:
			matchOperator === FilterMatchOperator.Or
				? { test: "anyof", tests }
				: { test: "allof", tests },
	};
};

const NO_CLAUSES: FilterClauses = {
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
};

const leafClauses = (
	matchOperator: FilterClauses["matchOperator"],
	tests: FilterTestItem[],
): FilterClauses | null => {
	const literalClauses = tests.map(testClause);
	return literalClauses.every((clause) => clause !== undefined)
		? { matchOperator, literalClauses }
		: null;
};

const ruleClauses = ({ test }: FilterRuleV1Item): FilterClauses | null => {
	switch (test.test) {
		case "allof":
			return leafClauses(FilterMatchOperator.And, test.tests);
		case "anyof":
			return leafClauses(FilterMatchOperator.Or, test.tests);
		default:
			return leafClauses(FilterMatchOperator.And, [test]);
	}
};

export const filterClausesFromRule = (rule: FilterRuleV1Item): FilterClauses =>
	ruleClauses(rule) ?? NO_CLAUSES;

export const filterRuleHasClauses = (rule: FilterRuleV1Item): boolean =>
	ruleClauses(rule) !== null;

export const MAX_FILTER_RULE_LEAVES = 50;
export const MAX_FILTER_RULE_DEPTH = 5;

export type FilterRuleLeafItem = Extract<
	FilterTestItem,
	{ test: "header" | "address" | "hasWords" }
>;

const leavesOf = (test: FilterTestItem): FilterRuleLeafItem[] => {
	switch (test.test) {
		case "allof":
		case "anyof":
			return test.tests.flatMap(leavesOf);
		case "not":
			return leavesOf(test.operand);
		default:
			return [test];
	}
};

export const filterRuleLeaves = (
	rule: FilterRuleV1Item,
): FilterRuleLeafItem[] => leavesOf(rule.test);

const depthOf = (test: FilterTestItem): number => {
	switch (test.test) {
		case "allof":
		case "anyof":
			return 1 + Math.max(0, ...test.tests.map(depthOf));
		case "not":
			return 1 + depthOf(test.operand);
		default:
			return 1;
	}
};

export const filterRuleLimitRefusal = (
	rule: FilterRuleV1Item,
): string | null => {
	const leaves = filterRuleLeaves(rule).length;
	if (leaves === 0) {
		return "A rule needs at least one header, address or hasWords test.";
	}
	if (leaves > MAX_FILTER_RULE_LEAVES) {
		return `A rule holds at most ${MAX_FILTER_RULE_LEAVES} header, address or hasWords tests; this one holds ${leaves}.`;
	}
	const depth = depthOf(rule.test);
	if (depth > MAX_FILTER_RULE_DEPTH) {
		return `A rule nests at most ${MAX_FILTER_RULE_DEPTH} levels deep, counting its top test; this one nests ${depth}.`;
	}
	return null;
};

// A rule built from no clauses, as a filter-backed organize job stores it,
// holds an empty top node that a new rule may not, and still reads.
const NoClauseRuleSchema = z.object({
	version: z.literal(1),
	test: z.union([
		z.object({ test: z.literal("allof"), tests: z.tuple([]) }),
		z.object({ test: z.literal("anyof"), tests: z.tuple([]) }),
	]),
});

const StoredFilterRuleSchema = z.union([
	FilterRuleV0Schema,
	FilterRuleV1Schema,
	NoClauseRuleSchema,
]);

export const readStoredFilterRule = (
	stored: unknown,
	clauses: FilterClauses,
): FilterClauses & { rule: FilterRuleV1Item } => {
	const rule = StoredFilterRuleSchema.parse(stored);
	if (rule.version === 0) {
		return { ...clauses, rule: filterRuleFromClauses(clauses) };
	}
	return { ...filterClausesFromRule(rule), rule };
};
