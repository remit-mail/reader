import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	filterClausesFromRule,
	filterRuleFromClauses,
	readStoredFilterRule,
} from "./filter-rule.js";
import type {
	FilterClauseItem,
	FilterClauses,
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

	it("refuses a stored rule of an unknown version", () => {
		assert.throws(() => readStoredFilterRule({ version: 2 }, clauses));
	});
});
