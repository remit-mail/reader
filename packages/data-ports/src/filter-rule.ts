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
			return { test: "hasWords", words: [clause.value] };
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
): FilterClauses => {
	const literalClauses = tests.map(testClause);
	return literalClauses.every((clause) => clause !== undefined)
		? { matchOperator, literalClauses }
		: NO_CLAUSES;
};

export const filterClausesFromRule = ({
	test,
}: FilterRuleV1Item): FilterClauses => {
	switch (test.test) {
		case "allof":
			return leafClauses(FilterMatchOperator.And, test.tests);
		case "anyof":
			return leafClauses(FilterMatchOperator.Or, test.tests);
		default:
			return leafClauses(FilterMatchOperator.And, [test]);
	}
};

const StoredFilterRuleSchema = z.union([
	FilterRuleV0Schema,
	FilterRuleV1Schema,
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
