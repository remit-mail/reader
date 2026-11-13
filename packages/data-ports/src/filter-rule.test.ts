import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	filterClausesFromRule,
	filterRuleFromClauses,
	filterRuleLimitRefusal,
	MAX_FILTER_RULE_DEPTH,
	MAX_FILTER_RULE_LEAVES,
	narrowFromDomainRule,
	readStoredFilterRule,
} from "./filter-rule.js";
import type {
	FilterClauseItem,
	FilterClauses,
	FilterRuleV1Item,
	FilterTestItem,
} from "./types.js";

const CLAUSE_TESTS: [FilterClauseItem, FilterTestItem][] = [
	[
		{ field: "From", value: "ada@example.com" },
		{
			test: "header",
			match: "Contains",
			header: "From",
			key: "ada@example.com",
		},
	],
	[
		{ field: "Subject", value: "invoice" },
		{ test: "header", match: "Contains", header: "Subject", key: "invoice" },
	],
	[
		{ field: "ListId", value: "weekly.news.example.com" },
		{
			test: "header",
			match: "Is",
			header: "ListId",
			key: "weekly.news.example.com",
		},
	],
	[
		{ field: "FromDomain", value: "github.com" },
		{
			test: "address",
			match: "Is",
			part: "RegistrableDomain",
			key: "github.com",
		},
	],
	[
		{ field: "HasWords", value: "overdue invoice" },
		{ test: "hasWords", words: ["overdue", "invoice"] },
	],
];

const OPERATOR_NODES: [FilterClauses["matchOperator"], "allof" | "anyof"][] = [
	["And", "allof"],
	["Or", "anyof"],
];

describe("filterRuleFromClauses", () => {
	for (const [clause, test] of CLAUSE_TESTS) {
		it(`maps a ${clause.field} clause to its test and back`, () => {
			for (const [matchOperator, node] of OPERATOR_NODES) {
				const clauses = { matchOperator, literalClauses: [clause] };
				const rule = filterRuleFromClauses(clauses);

				assert.deepEqual(rule, {
					version: 1,
					test: { test: node, tests: [test] },
				});
				assert.deepEqual(filterClausesFromRule(rule), clauses);
			}
		});
	}

	it("round-trips every clause kind under one operator", () => {
		const clauses: FilterClauses = {
			matchOperator: "Or",
			literalClauses: CLAUSE_TESTS.map(([clause]) => clause),
		};

		assert.deepEqual(
			filterClausesFromRule(filterRuleFromClauses(clauses)),
			clauses,
		);
	});
});

const FROM_DOMAIN_VALUES: [string, FilterTestItem][] = [
	...[
		"gamma.nl.",
		"@gamma.nl",
		"user@gamma.nl",
		".gamma.nl",
		"https://gamma.nl",
	].map((value): [string, FilterTestItem] => [
		value,
		{
			test: "address",
			match: "Is",
			part: "RegistrableDomain",
			key: "gamma.nl",
		},
	]),
	[
		"email.triodos.nl",
		{ test: "address", match: "Is", part: "Domain", key: "email.triodos.nl" },
	],
];

describe("a FromDomain value", () => {
	for (const [value, test] of FROM_DOMAIN_VALUES) {
		it(`reads ${value} as a bare host when compiled and when narrowed`, () => {
			assert.deepEqual(
				filterRuleFromClauses({
					matchOperator: "And",
					literalClauses: [{ field: "FromDomain", value }],
				}).test,
				{ test: "allof", tests: [test] },
			);
			assert.deepEqual(
				narrowFromDomainRule({
					version: 1,
					test: {
						test: "not",
						operand: {
							test: "address",
							match: "Is",
							part: "RegistrableDomain",
							key: value,
						},
					},
				}).test,
				{ test: "not", operand: test },
			);
		});
	}
});

describe("filterClausesFromRule", () => {
	it("reads a single leaf as one And clause", () => {
		assert.deepEqual(
			filterClausesFromRule({ version: 1, test: CLAUSE_TESTS[1][1] }),
			{ matchOperator: "And", literalClauses: [CLAUSE_TESTS[1][0]] },
		);
	});

	it("reads a rule no clause list expresses as no clauses", () => {
		const unflat: FilterTestItem[] = [
			{ test: "not", operand: CLAUSE_TESTS[0][1] },
			{
				test: "allof",
				tests: [{ test: "anyof", tests: [CLAUSE_TESTS[0][1]] }],
			},
			{
				test: "anyof",
				tests: [
					CLAUSE_TESTS[1][1],
					{ test: "header", match: "Is", header: "From", key: "ada" },
				],
			},
			{ test: "address", match: "Contains", part: "Domain", key: "ada" },
		];

		for (const test of unflat) {
			assert.deepEqual(filterClausesFromRule({ version: 1, test }), {
				matchOperator: "And",
				literalClauses: [],
			});
		}
	});
});

describe("readStoredFilterRule", () => {
	const clauses: FilterClauses = {
		matchOperator: "Or",
		literalClauses: [CLAUSE_TESTS[0][0], CLAUSE_TESTS[3][0]],
	};

	it("reads a version 0 row as version 1 from its literal clauses", () => {
		assert.deepEqual(readStoredFilterRule({ version: 0 }, clauses), {
			...clauses,
			rule: {
				version: 1,
				test: {
					test: "anyof",
					tests: [CLAUSE_TESTS[0][1], CLAUSE_TESTS[3][1]],
				},
			},
		});
	});

	it("reads a version 1 row from its rule, ignoring the empty clause column", () => {
		const rule = filterRuleFromClauses(clauses);

		assert.deepEqual(
			readStoredFilterRule(rule, { matchOperator: "And", literalClauses: [] }),
			{ ...clauses, rule },
		);
	});

	it("reads a stored rule built from no clauses", () => {
		const rule = filterRuleFromClauses({
			matchOperator: "And",
			literalClauses: [],
		});

		assert.deepEqual(
			readStoredFilterRule(rule, { matchOperator: "And", literalClauses: [] }),
			{ matchOperator: "And", literalClauses: [], rule },
		);
	});

	it("refuses a stored rule of an unknown version", () => {
		assert.throws(() => readStoredFilterRule({ version: 2 }, clauses));
	});
});

describe("filterRuleLimitRefusal", () => {
	const leaf: FilterTestItem = CLAUSE_TESTS[1][1];

	const flat = (leaves: number): FilterRuleV1Item => ({
		version: 1,
		test: {
			test: "anyof",
			tests: Array.from({ length: leaves }, () => leaf),
		},
	});

	const nested = (depth: number): FilterRuleV1Item => {
		let test = leaf;
		for (let level = 1; level < depth; level++) {
			test = { test: "not", operand: test };
		}
		return { version: 1, test };
	};

	it("accepts a rule at the leaf cap and refuses one past it", () => {
		assert.equal(filterRuleLimitRefusal(flat(MAX_FILTER_RULE_LEAVES)), null);
		assert.match(
			filterRuleLimitRefusal(flat(MAX_FILTER_RULE_LEAVES + 1)) ?? "",
			/at most 50/,
		);
	});

	it("accepts a rule at the depth cap and refuses one past it", () => {
		assert.equal(filterRuleLimitRefusal(nested(MAX_FILTER_RULE_DEPTH)), null);
		assert.match(
			filterRuleLimitRefusal(nested(MAX_FILTER_RULE_DEPTH + 1)) ?? "",
			/at most 5 levels/,
		);
	});

	it("refuses a rule with no leaf", () => {
		assert.match(filterRuleLimitRefusal(flat(0)) ?? "", /at least one/);
	});
});
