import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	describeSearchScope,
	escalatedStatusLabel,
	escalationActionLabel,
} from "./escalation-label.js";

describe("describeSearchScope", () => {
	test("free text query wins and is quoted", () => {
		assert.equal(describeSearchScope({ query: "npm" }), 'matching "npm"');
	});

	test("falls back to a from: filter when there's no free text", () => {
		assert.equal(
			describeSearchScope({ from: "billing@example.com" }),
			'from "billing@example.com"',
		);
	});

	test("free text wins over a from: filter when both are set", () => {
		assert.equal(
			describeSearchScope({ query: "npm", from: "noreply@npmjs.com" }),
			'matching "npm"',
		);
	});

	test("neither present falls back to a generic scope rather than throwing", () => {
		assert.equal(describeSearchScope({}), "matching your search");
	});
});

describe("escalationActionLabel", () => {
	test("names the scope, never a bare Select all", () => {
		assert.equal(
			escalationActionLabel({ query: "npm" }),
			'Select all matching "npm"',
		);
	});
});

describe("escalatedStatusLabel", () => {
	test("thousands-separates the total and names the scope", () => {
		assert.equal(
			escalatedStatusLabel({ query: "npm" }, 3412),
			'All 3,412 matching "npm" selected',
		);
	});
});
