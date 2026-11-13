import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type FilterRuleV1Item,
	type FilterTestItem,
	MAX_FILTER_RULE_LEAVES,
} from "@remit/data-ports";
import { getDomain } from "tldts";
import {
	evaluateRule,
	type FilterMessage,
	orderFilters,
	ruleNarrowing,
} from "./rule.js";

const message: FilterMessage = {
	from: "ci@builds.github.com",
	fromName: "GitHub Actions",
	subject: "Run failed: main",
	text: "The security scan found nothing.",
	listId: "builds.github.com",
};

const rule = (test: FilterTestItem): FilterRuleV1Item => ({ version: 1, test });

const subject = (key: string): FilterTestItem => ({
	test: "header",
	match: "Contains",
	header: "Subject",
	key,
});

const matches = (test: FilterTestItem, msg: FilterMessage = message) =>
	evaluateRule(rule(test), msg, getDomain);

describe("evaluateRule", () => {
	it("inverts its operand under not", () => {
		assert.equal(matches({ test: "not", operand: subject("failed") }), false);
		assert.equal(matches({ test: "not", operand: subject("passed") }), true);
	});

	it("requires every test under allof and any under anyof", () => {
		const both = [subject("failed"), subject("passed")];
		assert.equal(matches({ test: "allof", tests: both }), false);
		assert.equal(matches({ test: "anyof", tests: both }), true);
	});

	it("evaluates nested nodes", () => {
		const nested: FilterTestItem = {
			test: "allof",
			tests: [
				{
					test: "address",
					match: "Is",
					part: "RegistrableDomain",
					key: "github.com",
				},
				{
					test: "anyof",
					tests: [
						subject("deploy"),
						{ test: "not", operand: { test: "hasWords", words: ["urgent"] } },
					],
				},
			],
		};
		assert.equal(matches(nested), true);
		assert.equal(
			matches(nested, { ...message, text: "urgent: rotate keys" }),
			false,
		);
	});

	it("matches nothing with an empty allof or anyof", () => {
		assert.equal(matches({ test: "allof", tests: [] }), false);
		assert.equal(matches({ test: "anyof", tests: [] }), false);
		assert.equal(
			matches({ test: "not", operand: { test: "anyof", tests: [] } }),
			true,
		);
	});

	it("tells Is from Contains on a header", () => {
		const from = (match: "Is" | "Contains", key: string): FilterTestItem => ({
			test: "header",
			match,
			header: "From",
			key,
		});
		assert.equal(matches(from("Is", "github actions")), true);
		assert.equal(matches(from("Is", "github")), false);
		assert.equal(matches(from("Contains", "github")), true);
	});

	it("reads each part of the From address", () => {
		const address = (
			part: "All" | "Localpart" | "Domain" | "RegistrableDomain",
			match: "Is" | "Contains",
			key: string,
		): FilterTestItem => ({ test: "address", match, part, key });
		assert.equal(matches(address("All", "Is", "CI@builds.github.com")), true);
		assert.equal(matches(address("Localpart", "Is", "ci")), true);
		assert.equal(matches(address("Localpart", "Is", "builds")), false);
		assert.equal(matches(address("Domain", "Is", "builds.github.com")), true);
		assert.equal(matches(address("Domain", "Is", "github.com")), false);
		assert.equal(
			matches(address("RegistrableDomain", "Is", "github.com")),
			true,
		);
		assert.equal(
			matches(address("RegistrableDomain", "Contains", "hub")),
			true,
		);
	});

	it("compares a List-Id in its normalized form", () => {
		assert.equal(
			matches({
				test: "header",
				match: "Is",
				header: "ListId",
				key: "Builds <BUILDS.github.com>",
			}),
			true,
		);
	});
});

describe("ruleNarrowing", () => {
	const sender = (key: string): FilterTestItem => ({
		test: "header",
		match: "Contains",
		header: "From",
		key,
	});

	it("narrows a single leaf as an and-query of one term", () => {
		assert.deepEqual(ruleNarrowing(rule(sender("github")), getDomain), {
			terms: [{ field: "sender", contains: "github" }],
			operator: "and",
		});
	});

	it("narrows a flat allof and a flat anyof to their terms", () => {
		const tests = [sender("github"), subject("failed")];
		const terms = [
			{ field: "sender", contains: "github" },
			{ field: "subject", contains: "failed" },
		];
		assert.deepEqual(ruleNarrowing(rule({ test: "allof", tests }), getDomain), {
			terms,
			operator: "and",
		});
		assert.deepEqual(ruleNarrowing(rule({ test: "anyof", tests }), getDomain), {
			terms,
			operator: "or",
		});
	});

	it("narrows nothing when the top node is not or holds a nested node", () => {
		assert.deepEqual(
			ruleNarrowing(
				rule({ test: "not", operand: sender("github") }),
				getDomain,
			),
			{ terms: [], operator: "and" },
		);
		assert.deepEqual(
			ruleNarrowing(
				rule({
					test: "anyof",
					tests: [sender("github"), { test: "not", operand: subject("x") }],
				}),
				getDomain,
			),
			{ terms: [], operator: "or" },
		);
	});

	it("asks for nothing when the rule can match nothing", () => {
		assert.equal(
			ruleNarrowing(rule({ test: "allof", tests: [] }), getDomain),
			null,
		);
		assert.equal(
			ruleNarrowing(rule({ test: "allof", tests: [sender(" ")] }), getDomain),
			null,
		);
	});

	it("keeps a flat rule at the leaf cap to one term per leaf", () => {
		const tests = Array.from({ length: MAX_FILTER_RULE_LEAVES }, (_, index) =>
			sender(`sender-${index}.example`),
		);
		const narrowing = ruleNarrowing(rule({ test: "anyof", tests }), getDomain);
		assert.equal(narrowing?.terms.length, MAX_FILTER_RULE_LEAVES);
	});
});

describe("orderFilters", () => {
	const filter = (
		filterId: string,
		priority: number,
		actionChangedAt: number,
	) => ({
		filterId,
		priority,
		actionChangedAt,
	});

	it("runs lower priority first, then the newest actionChangedAt, then the greater filterId", () => {
		const ordered = orderFilters([
			filter("a", 1, 500),
			filter("b", 0, 100),
			filter("c", 0, 300),
			filter("d", 0, 300),
		]);
		assert.deepEqual(
			ordered.map((item) => item.filterId),
			["d", "c", "b", "a"],
		);
	});
});
